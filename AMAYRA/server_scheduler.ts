/**
 * AMAYRA — morning keep-awake scheduler.
 *
 * Marks a daily wake-up "due" at a user-configured time (HH:MM local). The
 * renderer polls the status endpoint and auto-opens the Live voice session
 * when a wake is due (its normal power-button flow), and the server injects
 * a spoken greeting into that session. If AMAYRA is already awake when the
 * time arrives, the renderer sends {type:"morningGreeting"} over the existing
 * WebSocket and the server injects the greeting there instead.
 *
 * Config and the last-completed-wake timestamp are persisted in the app's
 * data dir so a PC restart does not lose the schedule or double-fire.
 */

import fs from "fs";
import { dataFile } from "./server_paths";

export interface MorningSchedulerConfig {
  enabled: boolean;
  /** Local time of day in "HH:MM" (24h). */
  time: string;
}

interface SchedulerState extends MorningSchedulerConfig {
  /** Epoch ms of the last wake that was actually completed (greeting delivered). */
  lastCompletedWakeAt: number | null;
}

const DEFAULT_STATE: SchedulerState = {
  enabled: false,
  time: "08:00",
  lastCompletedWakeAt: null,
};

const SCHEDULE_FILE = dataFile("morning-schedule.json");

function loadState(): SchedulerState {
  try {
    if (fs.existsSync(SCHEDULE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(SCHEDULE_FILE, "utf-8")) as Partial<SchedulerState>;
      return {
        enabled: raw.enabled === true,
        time: parseTime(raw.time) ? (raw.time as string) : DEFAULT_STATE.time,
        lastCompletedWakeAt: typeof raw.lastCompletedWakeAt === "number" ? raw.lastCompletedWakeAt : null,
      };
    }
  } catch {
    /* corrupt file — fall back to defaults */
  }
  return { ...DEFAULT_STATE };
}

function saveState(state: SchedulerState): void {
  try {
    fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(state, null, 2), "utf-8");
  } catch {
    /* best-effort persistence */
  }
}

/** Validate "HH:MM" 24h. Returns normalized "HH:MM" or null. */
export function parseTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * The epoch ms of the most recent occurrence of `hh:mm` local time at or
 * before `now`. E.g. at 07:59 with time "08:00" this is *yesterday's* 08:00.
 */
export function latestOccurrenceAtOrBefore(hhmm: string, now: number): number {
  const [hours, minutes] = hhmm.split(":").map(Number);
  const candidate = new Date(now);
  candidate.setHours(hours, minutes, 0, 0);
  if (candidate.getTime() > now) candidate.setDate(candidate.getDate() - 1);
  return candidate.getTime();
}

/**
 * Whether the daily wake at `hh:mm` is due. Due means: today's slot has
 * arrived (now ≥ today's hh:mm) and it is later than the last completed
 * wake. A PC that was off through previous slots does NOT fire early — it
 * greets at today's slot, or catches up immediately if today's slot already
 * passed while the machine was off.
 */
export function isWakeDue(hhmm: string, lastCompletedWakeAt: number | null, now: number): boolean {
  const [hours, minutes] = hhmm.split(":").map(Number);
  const todaySlot = new Date(now);
  todaySlot.setHours(hours, minutes, 0, 0);
  if (todaySlot.getTime() > now) return false; // today's wake hasn't arrived yet
  if (!lastCompletedWakeAt) return true;
  return todaySlot.getTime() > lastCompletedWakeAt;
}

let state = loadState();

export function getMorningSchedule(): MorningSchedulerConfig & { lastCompletedWakeAt: number | null } {
  return { enabled: state.enabled, time: state.time, lastCompletedWakeAt: state.lastCompletedWakeAt };
}

export function setMorningSchedule(config: Partial<MorningSchedulerConfig>): MorningSchedulerConfig {
  if (config.time !== undefined) {
    const normalized = parseTime(config.time);
    if (!normalized) throw new Error("Time must be HH:MM between 00:00 and 23:59.");
    state.time = normalized;
  }
  if (config.enabled !== undefined) {
    state.enabled = config.enabled === true;
    // Re-enabling should not immediately fire for a slot that already passed
    // today: treat this slot as satisfied at the moment of enabling.
    if (state.enabled) {
      const slot = latestOccurrenceAtOrBefore(state.time, Date.now());
      if (!state.lastCompletedWakeAt || slot > state.lastCompletedWakeAt) {
        state.lastCompletedWakeAt = slot;
      }
    }
  }
  saveState(state);
  return { enabled: state.enabled, time: state.time };
}

/** Called once the greeting was actually spoken (or the wake attempt was made). */
export function markMorningWakeCompleted(): void {
  state.lastCompletedWakeAt = Date.now();
  saveState(state);
}

/** Minute tick: returns true exactly once per day when the time arrives. */
export function morningWakeDue(): boolean {
  if (!state.enabled) return false;
  if (!isWakeDue(state.time, state.lastCompletedWakeAt, Date.now())) return false;
  return true;
}

