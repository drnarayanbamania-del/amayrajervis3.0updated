/**
 * AMAYRA ↔ Telegram bridge.
 *
 * Lets the owner control AMAYRA (and, through her, the Windows PC) by sending
 * Telegram messages to their bot. Zero external dependencies: the Bot API is
 * plain HTTPS (getUpdates long-polling → sendMessage / sendPhoto) and Gemini
 * text generation reuses the same @google/genai SDK the core already ships.
 *
 * Security model:
 *  - The bot token lives in the per-user data dir (telegram.json), never in git.
 *  - PAIRING: the first chat that messages the bot becomes its owner; every
 *    other chat is silently ignored (logged only).
 *  - Tool execution flows through the same cognition ToolExecutor as the app,
 *    so the safety policy (permissions, risk levels, confirmations) applies
 *    unchanged. Confirmation-required actions are surfaced as /confirm <id>.
 */

import { GoogleGenAI, Type } from "@google/genai";
import type { Content, Part } from "@google/genai";
import fs from "fs";
import { randomUUID } from "node:crypto";

const TG_API = "https://api.telegram.org";
const TEXT_MODEL = "gemini-3.5-flash";
const MAX_TOOL_ROUNDS = 4;
const HISTORY_LIMIT = 10;
const MIN_MESSAGE_INTERVAL_MS = 700;
const REPLY_CHUNK = 3800;
const LONG_POLL_SECONDS = 25;
const REQUEST_TIMEOUT_MS = 40_000;

export type TelegramSeverity = "transient" | "degraded" | "critical";

export interface TelegramToolOutcome {
  success: boolean;
  status: string;
  result?: unknown;
  error?: string | null;
  confirmationId?: string;
}

export interface TelegramBridgeOptions {
  configPath: string;
  getApiKey: () => string | undefined;
  retrieveMemories(text: string): Promise<Array<{ text?: string }>>;
  executeTool(tool: string, args: Record<string, unknown>): Promise<TelegramToolOutcome>;
  confirmTool(confirmationId: string): Promise<unknown>;
  publishEvent(event: {
    type: string;
    source: string;
    importance: number;
    correlationId?: string;
    metadata?: Record<string, unknown>;
  }): void;
  reportError(severity: TelegramSeverity, scope: string, message: string): void;
  logCommand(line: string): void;
  logStartup(line: string): void;
  logError(line: string): void;
  /** Optional human-readable one-line core summary for /status. */
  collectStatus?(): Promise<string>;
}

interface TelegramConfig {
  botToken?: string;
  botUsername?: string;
  pairedChatId?: number;
  pairedName?: string;
  pairedAt?: string;
}

interface TelegramMessage {
  message_id: number;
  date: number;
  chat: { id: number; type: string; first_name?: string; username?: string; title?: string };
  from?: { id: number; first_name?: string; username?: string };
  text?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

// Curated remote-control toolset. Argument names must match the desktop agent
// registry exactly (mirrors the declarations in server.ts).
const TELEGRAM_TOOLS = [
  {
    name: "openApplication",
    description: "Open an installed Windows application by name.",
    parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING } }, required: ["name"] },
  },
  {
    name: "closeApplication",
    description: "Close a running application by name. Set force only when the user asks to force-close.",
    parameters: {
      type: Type.OBJECT,
      properties: { name: { type: Type.STRING }, force: { type: Type.BOOLEAN } },
      required: ["name"],
    },
  },
  {
    name: "openWebsite",
    description: "Open a website (name shortcut like 'youtube' or a full URL) in the default browser.",
    parameters: {
      type: Type.OBJECT,
      properties: { name: { type: Type.STRING }, url: { type: Type.STRING } },
    },
  },
  {
    name: "searchWeb",
    description: "Search the web (google, youtube, github, duckduckgo, bing) and open the results page.",
    parameters: {
      type: Type.OBJECT,
      properties: { query: { type: Type.STRING }, engine: { type: Type.STRING } },
      required: ["query"],
    },
  },
  {
    name: "searchYouTube",
    description: "Search YouTube and open the results page.",
    parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING } }, required: ["query"] },
  },
  { name: "volumeUp", description: "Raise system volume one step.", parameters: { type: Type.OBJECT, properties: {} } },
  { name: "volumeDown", description: "Lower system volume one step.", parameters: { type: Type.OBJECT, properties: {} } },
  { name: "muteToggle", description: "Toggle system mute.", parameters: { type: Type.OBJECT, properties: {} } },
  {
    name: "setVolume",
    description: "Set system volume to a percentage (0-100).",
    parameters: { type: Type.OBJECT, properties: { percent: { type: Type.NUMBER } }, required: ["percent"] },
  },
  {
    name: "typeText",
    description: "Type literal text into the currently focused window/control.",
    parameters: {
      type: Type.OBJECT,
      properties: { text: { type: Type.STRING } },
      required: ["text"],
    },
  },
  {
    name: "pressKey",
    description: "Press a keyboard key (e.g. enter, tab, esc) a number of times.",
    parameters: {
      type: Type.OBJECT,
      properties: { key: { type: Type.STRING }, presses: { type: Type.INTEGER } },
      required: ["key"],
    },
  },
  {
    name: "hotkey",
    description: "Press a key combination of 2-5 keys, e.g. ['ctrl','shift','esc'].",
    parameters: {
      type: Type.OBJECT,
      properties: { keys: { type: Type.ARRAY, items: { type: Type.STRING } } },
      required: ["keys"],
    },
  },
  {
    name: "click",
    description: "Click at optional screen coordinates (x, y) or at the current cursor position.",
    parameters: {
      type: Type.OBJECT,
      properties: { x: { type: Type.INTEGER }, y: { type: Type.INTEGER }, button: { type: Type.STRING } },
    },
  },
  {
    name: "scroll",
    description: "Scroll at the cursor: positive amount scrolls up, negative scrolls down.",
    parameters: {
      type: Type.OBJECT,
      properties: { amount: { type: Type.INTEGER } },
      required: ["amount"],
    },
  },
  {
    name: "getActiveWindow",
    description: "Get the title of the currently focused window.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "listVisibleWindows",
    description: "List all currently visible window titles.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "systemInfo",
    description: "Get system information (CPU, RAM, OS).",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "takeScreenshot",
    description: "Capture the screen; the photo is sent back to the user on Telegram.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "saveCustomMemory",
    description: "Persist an important fact about the user to AMAYRA's long-term memory.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        category: {
          type: Type.STRING,
          enum: ["identity", "preference", "goal", "project", "relationship", "emotional", "behavior"],
        },
        text: { type: Type.STRING },
      },
      required: ["category", "text"],
    },
  },
  {
    name: "requestPowerAction",
    description:
      "FIRST STEP for power actions (shutdown, restart, sleep, lock). Returns a confirmation token; ask the user to confirm with /confirm <id>.",
    parameters: {
      type: Type.OBJECT,
      properties: { action: { type: Type.STRING, enum: ["shutdown", "restart", "sleep", "lock"] } },
      required: ["action"],
    },
  },
  {
    name: "executePowerAction",
    description: "Execute a power action using the token returned by requestPowerAction, after explicit user confirmation.",
    parameters: {
      type: Type.OBJECT,
      properties: { token: { type: Type.STRING } },
      required: ["token"],
    },
  },
];

const SYSTEM_INSTRUCTION = `You are AMAYRA, a warm, witty AI companion running on your owner's Windows PC. You are talking over Telegram text messages.

Style: short, chat-style replies (1-4 sentences unless detail is clearly needed). Mirror the user's language — Hinglish, Hindi, or English. Occasional light emoji are fine.

Abilities: you control the owner's PC through tools — open/close applications and websites, search the web, control volume, type text, press keys, click, scroll, take screenshots (the photo is delivered automatically), read system info, and save important facts to long-term memory.

Rules:
- NEVER reveal secrets, API keys, tokens, or credential-like file contents.
- For shutdown/restart/sleep/lock: call requestPowerAction first, then executePowerAction only after the user explicitly confirms. If a tool returns confirmation_required, tell the user to send /confirm <id> in this chat.
- If a tool fails, briefly say what happened. Do not pretend an action succeeded.
- You cannot see the screen unless you call takeScreenshot.`;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function chunkText(text: string): string[] {
  if (text.length <= REPLY_CHUNK) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > REPLY_CHUNK) {
    let cut = rest.lastIndexOf("\n", REPLY_CHUNK);
    if (cut < REPLY_CHUNK / 2) cut = REPLY_CHUNK;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.trim()) chunks.push(rest);
  return chunks;
}

export class TelegramBridge {
  private config: TelegramConfig = {};
  private readonly history = new Map<number, Array<{ role: "user" | "model"; text: string }>>();
  private readonly lastMessageAt = new Map<number, number>();
  private offset = 0;
  private stopController: AbortController | null = null;
  private startedAt = Date.now();

  constructor(private readonly options: TelegramBridgeOptions) {
    this.config = this.readConfig();
  }

  // ---------------------------------------------------------------- config

  private readConfig(): TelegramConfig {
    try {
      if (fs.existsSync(this.options.configPath)) {
        return JSON.parse(fs.readFileSync(this.options.configPath, "utf-8")) as TelegramConfig;
      }
    } catch {
      /* corrupt — treat as empty */
    }
    return {};
  }

  private saveConfig(): void {
    try {
      fs.writeFileSync(this.options.configPath, JSON.stringify(this.config, null, 2), "utf-8");
    } catch (error) {
      this.options.logError(`TELEGRAM_CONFIG_SAVE_FAILED: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  status(): {
    configured: boolean;
    running: boolean;
    botUsername: string | null;
    pairedChatId: number | null;
    pairedName: string | null;
    pairedAt: string | null;
    uptimeSeconds: number;
  } {
    return {
      configured: Boolean(this.config.botToken),
      running: this.stopController !== null,
      botUsername: this.config.botUsername ?? null,
      pairedChatId: this.config.pairedChatId ?? null,
      pairedName: this.config.pairedName ?? null,
      pairedAt: this.config.pairedAt ?? null,
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
    };
  }

  /** Validate + persist the bot token, then (re)start polling. */
  async setToken(token: string): Promise<void> {
    const trimmed = token.trim();
    if (!trimmed) throw new Error("Bot token is required.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    timer.unref?.();
    try {
      const res = await fetch(`${TG_API}/bot${trimmed}/getMe`, { signal: controller.signal });
      if (!res.ok) throw new Error("Telegram rejected this token (check it via @BotFather /token).");
      const data = (await res.json()) as { ok: boolean; result?: { username?: string } };
      this.config.botToken = trimmed;
      this.config.botUsername = data.result?.username ?? undefined;
      this.saveConfig();
      this.options.logCommand(`TELEGRAM_TOKEN_SAVED bot=@${this.config.botUsername ?? "unknown"}`);
    } finally {
      clearTimeout(timer);
    }
    this.stop();
    this.start();
  }

  clearPairing(): void {
    delete this.config.pairedChatId;
    delete this.config.pairedName;
    delete this.config.pairedAt;
    this.saveConfig();
    this.options.logCommand("TELEGRAM_UNPAIRED");
  }

  // ---------------------------------------------------------------- polling

  start(): void {
    if (this.stopController) return; // already running
    if (!this.config.botToken) {
      this.options.logStartup("TELEGRAM_DISABLED no bot token configured (POST /api/telegram/config to enable)");
      return;
    }
    this.startedAt = Date.now();
    this.stopController = new AbortController();
    void this.pollLoop(this.stopController.signal);
  }

  stop(): void {
    this.stopController?.abort();
    this.stopController = null;
  }

  private async pollLoop(signal: AbortSignal): Promise<void> {
    const token = this.config.botToken!;
    this.options.logStartup(`TELEGRAM_POLLING_STARTED bot=@${this.config.botUsername ?? "unknown"}`);
    let consecutiveErrors = 0;
    while (!signal.aborted) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      timer.unref?.();
      const abortFromStop = () => controller.abort();
      signal.addEventListener("abort", abortFromStop, { once: true });
      try {
        const res = await fetch(
          `${TG_API}/bot${token}/getUpdates?timeout=${LONG_POLL_SECONDS}&offset=${this.offset}`,
          { signal: controller.signal },
        );
        if (!res.ok) {
          consecutiveErrors += 1;
          const body = await res.text().catch(() => "");
          if (res.status === 401) {
            this.options.reportError("degraded", "telegram.auth", "Telegram rejected the bot token (401). Replace it via POST /api/telegram/config.");
            await sleep(30_000, signal);
          } else if (res.status === 409) {
            this.options.reportError("degraded", "telegram.conflict", "Another poller (a second AMAYRA instance?) is using this bot token (409).");
            await sleep(30_000, signal);
          } else {
            this.options.reportError("transient", "telegram.poll", `getUpdates HTTP ${res.status}: ${body.slice(0, 160)}`);
            await sleep(5_000, signal);
          }
          continue;
        }
        consecutiveErrors = 0;
        const data = (await res.json()) as { ok: boolean; result?: TelegramUpdate[] };
        for (const update of data.result ?? []) {
          this.offset = Math.max(this.offset, update.update_id + 1);
          void this.handleUpdate(update).catch((error) => {
            this.options.reportError("degraded", "telegram.update", error instanceof Error ? error.message : String(error));
          });
        }
      } catch (error) {
        if (signal.aborted) return;
        consecutiveErrors += 1;
        const message = error instanceof Error ? error.message : String(error);
        if (!/abort/i.test(message)) {
          this.options.reportError("transient", "telegram.poll", `Network error: ${message}`);
        }
        await sleep(Math.min(5_000 * consecutiveErrors, 30_000), signal);
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", abortFromStop);
      }
    }
  }

  // ---------------------------------------------------------------- updates

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    const msg = update.message; // ignore edited_message etc.
    const text = msg?.text?.trim();
    if (!msg || !text) return;

    // Pairing: first chat wins; everyone else is ignored.
    if (this.config.pairedChatId === undefined) {
      this.config.pairedChatId = msg.chat.id;
      this.config.pairedName = msg.from?.first_name ?? msg.chat.first_name ?? msg.chat.username ?? undefined;
      this.config.pairedAt = new Date().toISOString();
      this.saveConfig();
      this.options.logCommand(`TELEGRAM_PAIRED chat=${msg.chat.id} name=${this.config.pairedName ?? "unknown"}`);
      await this.reply(msg.chat.id,
        "🔐 Paired! This Telegram is now AMAYRA's remote control.\n\n" +
        "Send me anything — I'll reply, and I can control the PC: apps, websites, volume, typing, clicks, screenshots.\n\n" +
        this.helpText());
      return;
    }
    if (msg.chat.id !== this.config.pairedChatId) {
      this.options.logCommand(`TELEGRAM_IGNORED_UNPAIRED chat=${msg.chat.id}`);
      return;
    }

    // Light rate limiting.
    const now = Date.now();
    const last = this.lastMessageAt.get(msg.chat.id) ?? 0;
    if (now - last < MIN_MESSAGE_INTERVAL_MS) return;
    this.lastMessageAt.set(msg.chat.id, now);

    this.options.logCommand(`TELEGRAM_MESSAGE chat=${msg.chat.id} len=${text.length}`);
    this.options.publishEvent({
      type: "conversation.telegram_message",
      source: "conversation",
      importance: 0.6,
      correlationId: `telegram-${msg.chat.id}`,
      metadata: { origin: "telegram", chatId: msg.chat.id, text },
    });

    try {
      if (text.startsWith("/")) await this.handleCommand(msg, text);
      else await this.handleConversation(msg, text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.options.reportError("degraded", "telegram.handle", message);
      await this.reply(msg.chat.id, `⚠️ ${message}`).catch(() => undefined);
    }
  }

  // ---------------------------------------------------------------- commands

  private helpText(): string {
    return [
      "📜 Commands:",
      "/status — core + agent health",
      "/screenshot — grab the PC screen",
      "/confirm <id> — approve a pending risky action",
      "/forget — unpair this chat",
      "",
      "Or just talk: “notepad kholo”, “volume 40%”, “YouTube pe lofi chalao”, “what's my PC doing?”",
    ].join("\n");
  }

  private async handleCommand(msg: TelegramMessage, text: string): Promise<void> {
    const [command, ...rest] = text.split(/\s+/);
    const chatId = msg.chat.id;
    switch (command.toLowerCase()) {
      case "/start":
        await this.reply(chatId, "👋 AMAYRA online. " + this.helpText());
        return;
      case "/help":
        await this.reply(chatId, this.helpText());
        return;
      case "/status": {
        const lines = [
          `🤖 @${this.config.botUsername ?? "bot"} · polling ${this.stopController ? "live" : "stopped"}`,
          `🔗 paired: ${this.config.pairedName ?? "unknown"} (${this.config.pairedChatId})`,
        ];
        if (this.options.collectStatus) {
          try { lines.push(await this.options.collectStatus()); } catch { /* non-fatal */ }
        }
        await this.reply(chatId, lines.join("\n"));
        return;
      }
      case "/confirm": {
        const id = rest[0];
        if (!id) { await this.reply(chatId, "Usage: /confirm <id>"); return; }
        const outcome = await this.options.confirmTool(id);
        const result = outcome as { success?: boolean; status?: string; result?: unknown; error?: string | null };
        const body = result?.success
          ? `✅ Executed (${result.status ?? "ok"}).`
          : `❌ Not executed (${result?.status ?? "failed"}${result?.error ? `: ${result.error}` : ""}).`;
        await this.reply(chatId, body);
        return;
      }
      case "/screenshot": {
        const outcome = await this.options.executeTool("takeScreenshot", { include_image: true, max_dim: 1280 });
        const image = this.extractImage(outcome.result);
        if (outcome.success && image) {
          await this.sendPhoto(chatId, image, "🖥️ Current screen");
        } else {
          await this.reply(chatId, `⚠️ Screenshot failed: ${outcome.error ?? "no image returned"}`);
        }
        return;
      }
      case "/forget":
        this.clearPairing();
        await this.reply(chatId, "🔓 Unpaired. The next chat to message this bot becomes its owner.");
        return;
      default:
        await this.reply(chatId, `Unknown command ${command}. ${this.helpText()}`);
        return;
    }
  }

  // ---------------------------------------------------------------- conversation

  private historyFor(chatId: number): Array<{ role: "user" | "model"; text: string }> {
    let list = this.history.get(chatId);
    if (!list) { list = []; this.history.set(chatId, list); }
    return list;
  }

  private async handleConversation(msg: TelegramMessage, text: string): Promise<void> {
    const apiKey = this.options.getApiKey();
    if (!apiKey) {
      await this.reply(msg.chat.id, "⚠️ No Gemini API key is configured on the core, so I can't think right now.");
      return;
    }
    const client = new GoogleGenAI({ apiKey });

    let memoryCard = "";
    try {
      const recalled = await this.options.retrieveMemories(text);
      if (recalled.length) {
        memoryCard = "\n\nRelevant memories:\n" + recalled.map((m) => `- ${m.text ?? ""}`.trimEnd()).join("\n");
      }
    } catch { /* memory recall is best-effort */ }

    const history = this.historyFor(msg.chat.id);
    const contents: Content[] = [
      ...history.map((entry) => ({ role: entry.role, parts: [{ text: entry.text }] as Part[] })),
      { role: "user" as const, parts: [{ text: text + memoryCard } as Part] },
    ];

    let finalText = "";
    let pendingScreenshot: string | null = null;

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
      const response = await client.models.generateContent({
        model: TEXT_MODEL,
        contents,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          tools: [{ functionDeclarations: TELEGRAM_TOOLS }],
        },
      });
      const calls = response.functionCalls ?? [];
      if (!calls.length) {
        finalText = response.text ?? "";
        break;
      }
      contents.push({
        role: "model",
        parts: calls.map((call) => ({ functionCall: { name: call.name ?? "", args: call.args ?? {} } }) as Part),
      });
      const responseParts: Part[] = [];
      for (const call of calls) {
        const name = call.name ?? "";
        const args = { ...(call.args ?? {}) } as Record<string, unknown>;
        let outcome: TelegramToolOutcome;
        if (name === "takeScreenshot") {
          args.include_image = true;
          args.max_dim = 1280;
          outcome = await this.options.executeTool(name, args);
          pendingScreenshot = this.extractImage(outcome.result) ?? pendingScreenshot;
        } else {
          outcome = await this.options.executeTool(name, args);
        }
        this.options.logCommand(`TELEGRAM_TOOL ${name} status=${outcome.status}`);
        responseParts.push({
          functionResponse: {
            name,
            response: {
              ok: outcome.success,
              status: outcome.status,
              output: summarizeResult(outcome.result),
              error: outcome.error ?? null,
              confirmation_id: outcome.confirmationId ?? null,
            },
          },
        });
      }
      contents.push({ role: "user", parts: responseParts });
      if (round === MAX_TOOL_ROUNDS) finalText = response.text ?? "I hit my tool-use limit for this message.";
    }

    if (pendingScreenshot) {
      await this.sendPhoto(msg.chat.id, pendingScreenshot).catch(() => undefined);
    }
    finalText = (finalText || "Done.").trim();
    await this.reply(msg.chat.id, finalText);

    history.push({ role: "user", text });
    history.push({ role: "model", text: finalText });
    while (history.length > HISTORY_LIMIT) history.shift();
  }

  // ---------------------------------------------------------------- replies

  private async apiCall(method: string, body: unknown): Promise<void> {
    const token = this.config.botToken;
    if (!token) throw new Error("Bot token is not configured.");
    const res = await fetch(`${TG_API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Telegram ${method} failed (${res.status}): ${detail.slice(0, 160)}`);
    }
  }

  private async reply(chatId: number, text: string): Promise<void> {
    for (const chunk of chunkText(text)) {
      await this.apiCall("sendMessage", { chat_id: chatId, text: chunk });
    }
  }

  private async sendPhoto(chatId: number, imageBase64: string, caption?: string): Promise<void> {
    const token = this.config.botToken;
    if (!token) throw new Error("Bot token is not configured.");
    const form = new FormData();
    form.append("chat_id", String(chatId));
    if (caption) form.append("caption", caption);
    const bytes = Buffer.from(imageBase64, "base64");
    form.append("photo", new Blob([bytes], { type: "image/jpeg" }), "amayra-screenshot.jpg");
    const res = await fetch(`${TG_API}/bot${token}/sendPhoto`, { method: "POST", body: form });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Telegram sendPhoto failed (${res.status}): ${detail.slice(0, 160)}`);
    }
  }

  private extractImage(result: unknown): string | null {
    if (!result || typeof result !== "object") return null;
    const payload = result as Record<string, unknown>;
    const image = payload.image_base64 ?? payload.imageBase64 ?? payload.base64;
    return typeof image === "string" && image.length > 64 ? image : null;
  }
}

/** Compact JSON summary of a tool result so function responses stay small. */
function summarizeResult(result: unknown): unknown {
  if (result === null || result === undefined) return null;
  if (typeof result !== "object") return result;
  const payload = result as Record<string, unknown>;
  const slim: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === "string" && value.length > 400) slim[key] = value.slice(0, 400) + "…";
    else if (key === "image_base64" || key === "imageBase64") slim[key] = "<image delivered via sendPhoto>";
    else slim[key] = value;
  }
  return slim;
}
