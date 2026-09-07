import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * AMAYRA core error protocol.
 *
 * Single funnel for every core error — process-level faults (uncaught
 * exceptions, unhandled rejections), subsystem faults (cognition, desktop
 * agent, Gemini live session) and API surfaced errors. Errors are:
 *   1. recorded in a bounded in-memory ring (queryable via /api/core/errors),
 *   2. appended to <dataDir>/errors.log,
 *   3. published onto the cognitive event bus above a severity-dependent
 *      importance floor so the attention engine reacts like any other event.
 */

export type CoreErrorSeverity = "transient" | "degraded" | "critical";

export interface CoreErrorRecord {
  readonly id: string;
  readonly timestamp: string;
  readonly severity: CoreErrorSeverity;
  readonly scope: string;
  readonly message: string;
  readonly detail?: string;
  readonly recoverable: boolean;
}

export interface CoreErrorInput {
  readonly severity: CoreErrorSeverity;
  readonly scope: string;
  readonly message: string;
  readonly detail?: string;
  readonly recoverable?: boolean;
}

export interface ErrorProtocolOptions {
  /** Directory for errors.log. */
  dataDir: string;
  /** Publish a cognitive event for errors at or above the importance floor. */
  publishEvent?: (input: {
    type: string;
    source: string;
    importance: number;
    confidence: number;
    dedupeKey?: string;
    metadata: Record<string, unknown>;
  }) => void | Promise<void>;
  /** Called for critical, recoverable faults so the host can escalate. */
  onCritical?: (record: CoreErrorRecord) => void;
  /** Ring buffer capacity. Default 200. */
  maxRecords?: number;
}

const SEVERITY_IMPORTANCE: Record<CoreErrorSeverity, number> = {
  transient: 0.3,
  degraded: 0.55,
  critical: 0.85,
};

/**
 * Errors we emit ourselves (guarded callbacks, watchdog transitions) — safe to
 * publish straight onto the bus. Process-level faults are recorded first and
 * published defensively so a fault during publication cannot recurse.
 */
export class ErrorProtocol {
  private readonly records: CoreErrorRecord[] = [];
  private readonly maxRecords: number;
  private readonly errorLogPath: string;
  private installed = false;

  constructor(private readonly options: ErrorProtocolOptions) {
    this.maxRecords = options.maxRecords ?? 200;
    this.errorLogPath = join(options.dataDir, "errors.log");
  }

  /** Record an error, persist it, and (if important enough) publish it. */
  report(input: CoreErrorInput): CoreErrorRecord {
    const record: CoreErrorRecord = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      severity: input.severity,
      scope: input.scope,
      message: input.message,
      detail: input.detail,
      recoverable: input.recoverable ?? input.severity !== "critical",
    };
    this.records.push(record);
    if (this.records.length > this.maxRecords) {
      this.records.splice(0, this.records.length - this.maxRecords);
    }
    this.appendLog(record);

    const importance = SEVERITY_IMPORTANCE[input.severity];
    if (this.options.publishEvent && importance >= 0.3) {
      try {
        this.options.publishEvent({
          type: `system.core_error_${record.severity}`,
          source: "system",
          importance,
          confidence: 1,
          dedupeKey: `${record.scope}:${record.message}`.slice(0, 180),
          metadata: {
            errorId: record.id,
            scope: record.scope,
            message: record.message.slice(0, 400),
            recoverable: record.recoverable,
          },
        });
      } catch {
        // Never let event publication amplify a fault.
      }
    }
    if (record.severity === "critical" && this.options.onCritical) {
      try {
        this.options.onCritical(record);
      } catch {
        // Escalation must not throw.
      }
    }
    return record;
  }

  /** Wrap an async subsystem operation so faults become protocol records. */
  guard<T>(scope: string, operation: () => Promise<T>): Promise<T | null> {
    return operation().catch((error: unknown): T | null => {
      this.report({
        severity: "degraded",
        scope,
        message: error instanceof Error ? error.message : String(error),
        detail: error instanceof Error ? (error.stack || undefined) : undefined,
      });
      return null;
    });
  }

  recent(limit = 50): CoreErrorRecord[] {
    return this.records.slice(-Math.max(1, Math.min(limit, this.maxRecords))).reverse();
  }

  summary(): { total: number; bySeverity: Record<CoreErrorSeverity, number>; last: CoreErrorRecord | null } {
    const bySeverity: Record<CoreErrorSeverity, number> = { transient: 0, degraded: 0, critical: 0 };
    for (const record of this.records) bySeverity[record.severity] += 1;
    return { total: this.records.length, bySeverity, last: this.records[this.records.length - 1] || null };
  }

  /**
   * Install process-level guards exactly once. An uncaught exception is
   * logged and recorded, then the process exits with code 20 so a supervisor
   * (Electron shell, WMI task, watchdog) can restart it — matching the
   * fail-fast contract. Unhandled rejections are treated as degraded faults
   * and do not kill the process.
   */
  installProcessGuards(): void {
    if (this.installed) return;
    this.installed = true;

    // Broken-pipe immunity: losing the console (parent closed the pipe, app
    // quitting, WMI relaunch) must never kill the backend — the HTTP service
    // is independent of stdout/stderr. Without this, an EPIPE on a console
    // write surfaces as an uncaughtException and the fail-fast guard below
    // would take the whole backend down.
    for (const stream of [process.stdout, process.stderr]) {
      stream?.on?.("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EPIPE") return; // nobody is listening; keep serving
        throw error;
      });
    }

    process.on("uncaughtException", (error: Error) => {
      if ((error as NodeJS.ErrnoException).code === "EPIPE") {
        this.report({
          severity: "transient",
          scope: "process.epipe",
          message: "Broken pipe on a console stream ignored; backend keeps running.",
          recoverable: true,
        });
        return;
      }
      this.report({
        severity: "critical",
        scope: "process.uncaughtException",
        message: error.message,
        detail: error.stack,
        recoverable: false,
      });
      // Give the append a moment, then fail fast for the supervisor.
      setTimeout(() => process.exit(20), 150);
    });

    process.on("unhandledRejection", (reason: unknown) => {
      this.report({
        severity: "degraded",
        scope: "process.unhandledRejection",
        message: reason instanceof Error ? reason.message : String(reason),
        detail: reason instanceof Error ? reason.stack : undefined,
      });
    });
  }

  private appendLog(record: CoreErrorRecord): void {
    try {
      appendFileSync(this.errorLogPath, `${JSON.stringify(record)}\n`, "utf8");
    } catch {
      // Persistence is best-effort; the ring buffer still holds the record.
    }
  }
}
