/**
 * AMAYRA — multi-provider model fallback.
 *
 * AMAYRA's brain used to be hard-wired to Gemini. Gemini's free tier is
 * generous but tiny (20 requests/day on some models), and when it ran dry the
 * memory consolidation, Telegram alerts, phone /chat and the cognition router
 * all degraded together.
 *
 * This module turns every *text* generation into a fallback chain:
 *
 *     1. Gemini   (existing key, secrets.json / .env)
 *     2. Groq     (OpenAI-compatible, free tier)
 *     3. DeepSeek (OpenAI-compatible)
 *     4. OpenAI   (OpenAI-compatible)
 *
 * Rules:
 *  - Providers without a configured key are skipped silently.
 *  - A provider that returns a quota/rate-limit (or auth) failure is put on a
 *    one-hour cooldown so the chain stops hammering a dead key, and the next
 *    provider takes over immediately.
 *  - Keys are stored in provider-keys.json inside the per-user data dir, next
 *    to secrets.json. They are never returned to any client — only existence
 *    and cooldown state are reported.
 *  - Voice (Gemini Live) intentionally stays Gemini-only; this module only
 *    serves text generation.
 */

import fs from "fs";
import { GoogleGenAI } from "@google/genai";
import { dataFile, getGeminiApiKey } from "./server_paths";

export type ProviderId = "gemini" | "groq" | "deepseek" | "openai";

export const PROVIDER_IDS: ProviderId[] = ["gemini", "groq", "deepseek", "openai"];

/** Fallback order — Gemini first (richest tool-use), then the backups. */
const FALLBACK_ORDER: ProviderId[] = ["gemini", "groq", "deepseek", "openai"];

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  gemini: "Google Gemini",
  groq: "Groq",
  deepseek: "DeepSeek",
  openai: "OpenAI",
};

const PROVIDER_BASE_URLS: Record<Exclude<ProviderId, "gemini">, string> = {
  groq: "https://api.groq.com/openai/v1",
  deepseek: "https://api.deepseek.com/v1",
  openai: "https://api.openai.com/v1",
};

function modelFor(id: ProviderId): string {
  switch (id) {
    case "gemini":
      return process.env.AMAYRA_GEMINI_MODEL || "gemini-3.5-flash";
    case "groq":
      return process.env.AMAYRA_GROQ_MODEL || "llama-3.3-70b-versatile";
    case "deepseek":
      return process.env.AMAYRA_DEEPSEEK_MODEL || "deepseek-chat";
    case "openai":
      return process.env.AMAYRA_OPENAI_MODEL || "gpt-4o-mini";
  }
}

/** How long a failing provider is skipped before being retried. */
const PROVIDER_COOLDOWN_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Key storage (provider-keys.json in the data dir — never shipped, never sent
// to clients). The legacy Gemini key in secrets.json / .env keeps working.
// ---------------------------------------------------------------------------

interface ProviderKeyFile {
  gemini?: string;
  groq?: string;
  deepseek?: string;
  openai?: string;
}

const KEYS_FILE = dataFile("provider-keys.json");

function readKeyFile(): ProviderKeyFile {
  try {
    if (fs.existsSync(KEYS_FILE)) {
      return JSON.parse(fs.readFileSync(KEYS_FILE, "utf-8")) as ProviderKeyFile;
    }
  } catch {
    /* corrupt — treat as empty */
  }
  return {};
}

function writeKeyFile(next: ProviderKeyFile): void {
  fs.writeFileSync(KEYS_FILE, JSON.stringify(next, null, 2), "utf-8");
  try {
    fs.chmodSync(KEYS_FILE, 0o600); // owner-only where supported
  } catch {
    /* Windows ACLs differ; best-effort */
  }
}

/** Resolve every configured key (values never leave the backend). */
export function getProviderKeys(): Record<ProviderId, string | undefined> {
  const file = readKeyFile();
  return {
    gemini: file.gemini?.trim() || getGeminiApiKey(),
    groq: file.groq?.trim() || undefined,
    deepseek: file.deepseek?.trim() || undefined,
    openai: file.openai?.trim() || undefined,
  };
}

export function hasProviderKey(id: ProviderId): boolean {
  return Boolean(getProviderKeys()[id]);
}

/** Whether at least one provider can think right now. */
export function hasAnyProviderKey(): boolean {
  return PROVIDER_IDS.some((id) => hasProviderKey(id));
}

/** Persist (or replace) a provider key. Empty/whitespace keys are rejected. */
export function setProviderKey(id: ProviderId, key: string): void {
  const trimmed = (key || "").trim();
  if (!trimmed) throw new Error("API key must not be empty.");
  const current = readKeyFile();
  current[id] = trimmed;
  writeKeyFile(current);
}

/** Remove a stored provider key (the legacy Gemini env key may still exist). */
export function clearProviderKey(id: ProviderId): void {
  const current = readKeyFile();
  delete current[id];
  writeKeyFile(current);
}

// ---------------------------------------------------------------------------
// Cooldown state — a provider that just failed with quota/auth errors is
// skipped for a while so the fallback chain stops burning time on it.
// ---------------------------------------------------------------------------

const cooldownUntil = new Map<ProviderId, number>();

export function markProviderExhausted(id: ProviderId, reason: string): void {
  cooldownUntil.set(id, Date.now() + PROVIDER_COOLDOWN_MS);
  log("error", `PROVIDER_COOLDOWN ${id} for ${PROVIDER_COOLDOWN_MS / 60_000}m: ${reason}`);
}

export function markProviderOk(id: ProviderId): void {
  if (cooldownUntil.delete(id)) log("command", `PROVIDER_RECOVERED ${id}`);
}

export function providerCooldownRemainingMs(id: ProviderId): number {
  const until = cooldownUntil.get(id) ?? 0;
  return Math.max(0, until - Date.now());
}

function isProviderAvailable(id: ProviderId): boolean {
  return hasProviderKey(id) && providerCooldownRemainingMs(id) === 0;
}

/** Providers that can be used right now, in fallback order. */
export function availableProviderOrder(): ProviderId[] {
  return FALLBACK_ORDER.filter(isProviderAvailable);
}

// ---------------------------------------------------------------------------
// Logging (wired by the server; console before that).
// ---------------------------------------------------------------------------

type ProviderLogger = (line: string) => void;
let logCommand: ProviderLogger = (line) => console.log(`[Providers] ${line}`);
let logError: ProviderLogger = (line) => console.error(`[Providers] ${line}`);

export function setProviderLogger(handlers: { command: ProviderLogger; error: ProviderLogger }): void {
  logCommand = handlers.command;
  logError = handlers.error;
}

function log(kind: "command" | "error", line: string): void {
  (kind === "command" ? logCommand : logError)(line);
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export interface GenerateTextOptions {
  /** System-style instruction kept out of the user prompt. */
  systemInstruction?: string;
  /** Ask for strict JSON output (best-effort per provider). */
  jsonMode?: boolean;
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export interface GenerateTextResult {
  text: string;
  provider: ProviderId;
  model: string;
}

function isQuotaError(message: string): boolean {
  return /\b429\b|RESOURCE_EXHAUSTED|rate.?limit|quota|exceeded/i.test(message);
}

function isAuthError(message: string): boolean {
  return /\b401\b|\b403\b|UNAUTHENTICATED|PERMISSION_DENIED|invalid[_ ]?api[_ ]?key|authentication/i.test(message);
}

async function generateOnGemini(prompt: string, options: GenerateTextOptions): Promise<string> {
  const key = getProviderKeys().gemini;
  if (!key) throw new Error("No Gemini API key configured.");
  const client = new GoogleGenAI({ apiKey: key });
  const response = await client.models.generateContent({
    model: modelFor("gemini"),
    contents: prompt,
    config: {
      ...(options.systemInstruction ? { systemInstruction: options.systemInstruction } : {}),
      ...(options.jsonMode ? { responseMimeType: "application/json" } : {}),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.maxOutputTokens !== undefined ? { maxOutputTokens: options.maxOutputTokens } : {}),
    },
  });
  return (response.text ?? "").trim();
}

/** Shared chat/completions call for the OpenAI-compatible providers. */
async function generateOnOpenAiCompatible(
  id: Exclude<ProviderId, "gemini">,
  prompt: string,
  options: GenerateTextOptions,
): Promise<string> {
  const key = getProviderKeys()[id];
  if (!key) throw new Error(`No ${PROVIDER_LABELS[id]} API key configured.`);
  const messages: Array<{ role: "system" | "user"; content: string }> = [];
  if (options.systemInstruction) messages.push({ role: "system", content: options.systemInstruction });
  messages.push({ role: "user", content: prompt });

  const response = await fetch(`${PROVIDER_BASE_URLS[id]}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: modelFor(id),
      messages,
      ...(options.jsonMode ? { response_format: { type: "json_object" } } : {}),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.maxOutputTokens !== undefined ? { max_tokens: options.maxOutputTokens } : {}),
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 400);
    throw new Error(`${PROVIDER_LABELS[id]} HTTP ${response.status}: ${detail || "(no body)"}`);
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return (data.choices?.[0]?.message?.content ?? "").trim();
}

async function generateOnProvider(id: ProviderId, prompt: string, options: GenerateTextOptions): Promise<string> {
  if (id === "gemini") return generateOnGemini(prompt, options);
  return generateOnOpenAiCompatible(id, prompt, options);
}

/**
 * Generate text with automatic provider fallback.
 * Tries Gemini → Groq → DeepSeek → OpenAI; providers without a key or on
 * cooldown are skipped. Throws only if every available provider fails.
 */
export async function generateTextWithFallback(
  prompt: string,
  options: GenerateTextOptions = {},
): Promise<GenerateTextResult> {
  const order = availableProviderOrder();
  if (!order.length) {
    throw new Error(
      "No model API key is available. Add a Gemini, Groq, DeepSeek or OpenAI key in AMAYRA's API Keys settings.",
    );
  }

  let lastError = "";
  for (let i = 0; i < order.length; i += 1) {
    const id = order[i];
    if (options.signal?.aborted) throw new Error("Model call cancelled.");
    try {
      const text = await generateOnProvider(id, prompt, options);
      if (!text) throw new Error("Model returned an empty response.");
      markProviderOk(id);
      if (i > 0) log("command", `PROVIDER_FALLBACK_USED ${order[0]}→${id}`);
      log("command", `MODEL_VIA ${id} model=${modelFor(id)} chars=${text.length}`);
      return { text, provider: id, model: modelFor(id) };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (options.signal?.aborted) throw new Error("Model call cancelled.");
      const next = order[i + 1];
      if (isQuotaError(lastError) || isAuthError(lastError)) {
        markProviderExhausted(id, lastError.slice(0, 200));
      } else {
        log("error", `PROVIDER_FAILED ${id}: ${lastError.slice(0, 200)}`);
      }
      if (next) log("error", `PROVIDER_FALLBACK ${id}→${next}`);
    }
  }
  throw new Error(`All model providers failed. Last error: ${lastError}`);
}

/**
 * Validate a key WITHOUT saving it. For Gemini this lists models; for the
 * OpenAI-compatible providers it calls the free GET /models endpoint.
 * `authRejected` distinguishes a definitively bad key from a transient
 * network hiccup (which should still be saved).
 */
export async function checkProviderKey(
  id: ProviderId,
  key: string,
): Promise<{ ok: boolean; authRejected: boolean; message: string }> {
  const trimmed = (key || "").trim();
  if (!trimmed) return { ok: false, authRejected: false, message: "API key is required." };
  try {
    if (id === "gemini") {
      const client = new GoogleGenAI({ apiKey: trimmed });
      const pager = await client.models.list();
      await pager[Symbol.asyncIterator]().next(); // force the first request
    } else {
      const response = await fetch(`${PROVIDER_BASE_URLS[id]}/models`, {
        headers: { Authorization: `Bearer ${trimmed}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).slice(0, 200);
        const authRejected = response.status === 401 || response.status === 403;
        return {
          ok: false,
          authRejected,
          message: `${PROVIDER_LABELS[id]} rejected the key (HTTP ${response.status}): ${detail || "no details"}`,
        };
      }
    }
    return { ok: true, authRejected: false, message: "Key validated." };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, authRejected: isAuthError(message), message };
  }
}

/** Non-secret snapshot for the settings UI / status endpoint. */
export function describeProviderStatus(): Array<{
  id: ProviderId;
  label: string;
  model: string;
  hasKey: boolean;
  available: boolean;
  cooldownRemainingMs: number;
}> {
  return FALLBACK_ORDER.map((id) => ({
    id,
    label: PROVIDER_LABELS[id],
    model: modelFor(id),
    hasKey: hasProviderKey(id),
    available: isProviderAvailable(id),
    cooldownRemainingMs: providerCooldownRemainingMs(id),
  }));
}

// ---------------------------------------------------------------------------
// Tool-aware turns (function calling).
//
// Gemini keeps its native function-calling API. The OpenAI-compatible
// providers get a strict JSON tool protocol layered on top of chat/completions:
// the model must answer either {"function_calls":[...]} or {"text":"..."}.
// Callers always receive the same ToolAwareTurn shape either way.
// ---------------------------------------------------------------------------

export interface ToolDeclaration {
  name: string;
  description: string;
  /** JSON-schema-ish parameters object (Gemini Type enum values are tolerated). */
  parameters: unknown;
}

export interface ToolCallRequest {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolAwareTurn {
  text: string | null;
  functionCalls: ToolCallRequest[];
}

/** Gemini-style content list: roles user/model with text or function parts. */
export type GeminiStyleContents = Array<{
  role: "user" | "model";
  parts: Array<
    | { text: string }
    | { functionCall: { name: string; args?: Record<string, unknown> } }
    | { functionResponse: { name: string; response: Record<string, unknown> } }
  >;
}>;

/** Lowercase Gemini Type enum values into plain JSON-Schema type names. */
function normalizeSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeSchema);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = key === "type" && typeof item === "string" ? item.toLowerCase() : normalizeSchema(item);
    }
    return out;
  }
  return value;
}

function toolProtocolInstruction(tools: ToolDeclaration[]): string {
  const catalogue = JSON.stringify(
    tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: normalizeSchema(tool.parameters ?? {}),
    })),
  );
  return [
    "# Tool protocol",
    "You can use tools. Available tools:",
    catalogue,
    "To call tools, reply with ONLY this JSON (no prose, no markdown):",
    '{"function_calls":[{"name":"tool_name","args":{ ... }}]}',
    "Tool results arrive as a user message containing JSON under tool_results.",
    "When you are ready to answer (or need no tools), reply with ONLY:",
    '{"text":"your answer"}',
    "Never output anything except one of those two JSON objects.",
  ].join("\n");
}

function translateContentsToMessages(
  contents: GeminiStyleContents,
  systemInstruction: string,
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemInstruction },
  ];
  for (const entry of contents) {
    for (const part of entry.parts) {
      if ("text" in part && typeof part.text === "string") {
        messages.push({ role: entry.role === "model" ? "assistant" : "user", content: part.text });
      } else if ("functionCall" in part && part.functionCall) {
        messages.push({
          role: "assistant",
          content: JSON.stringify({ function_calls: [{ name: part.functionCall.name, args: part.functionCall.args ?? {} }] }),
        });
      } else if ("functionResponse" in part && part.functionResponse) {
        messages.push({
          role: "user",
          content: JSON.stringify({ tool_results: [{ name: part.functionResponse.name, result: part.functionResponse.response }] }),
        });
      }
    }
  }
  return messages;
}

function parseToolProtocolReply(raw: string, validTools: Set<string>): ToolAwareTurn {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("Tool protocol: model reply was not JSON.");
  const parsed = JSON.parse(text.slice(start, end + 1)) as {
    text?: unknown;
    function_calls?: Array<{ name?: unknown; args?: unknown }>;
  };
  if (Array.isArray(parsed.function_calls)) {
    const functionCalls = parsed.function_calls
      .filter((call) => typeof call?.name === "string" && validTools.has(call.name))
      .map((call) => ({
        name: call.name as string,
        args: (call.args && typeof call.args === "object" ? call.args : {}) as Record<string, unknown>,
      }));
    if (functionCalls.length) return { text: null, functionCalls };
  }
  return { text: typeof parsed.text === "string" ? parsed.text : null, functionCalls: [] };
}

async function generateTurnOnProvider(
  id: ProviderId,
  contents: GeminiStyleContents,
  systemInstruction: string,
  tools: ToolDeclaration[],
): Promise<ToolAwareTurn> {
  if (id === "gemini") {
    const key = getProviderKeys().gemini;
    if (!key) throw new Error("No Gemini API key configured.");
    const client = new GoogleGenAI({ apiKey: key });
    const response = await client.models.generateContent({
      model: modelFor("gemini"),
      contents,
      config: {
        systemInstruction,
        tools: [{ functionDeclarations: tools as never }],
      },
    });
    const calls = (response.functionCalls ?? []).map((call) => ({
      name: call.name ?? "",
      args: (call.args ?? {}) as Record<string, unknown>,
    }));
    return { text: response.text ?? null, functionCalls: calls.filter((call) => call.name) };
  }

  // OpenAI-compatible manual tool protocol.
  const validTools = new Set(tools.map((tool) => tool.name));
  const baseMessages = translateContentsToMessages(
    contents,
    `${systemInstruction}\n\n${toolProtocolInstruction(tools)}`,
  );
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const messages = [...baseMessages];
    if (attempt > 0) {
      messages.push({
        role: "user",
        content: 'Your previous reply was not valid protocol JSON. Answer again with ONLY {"text":"..."} or {"function_calls":[...]}.',
      });
    }
    const raw = await generateChatMessages(id, messages, { jsonMode: true, temperature: 0.6 });
    return parseToolProtocolReply(raw, validTools);
  }
  throw new Error("Tool protocol: no valid reply after retry.");
}

/** Chat/completions with an explicit message list (used by the tool protocol). */
async function generateChatMessages(
  id: Exclude<ProviderId, "gemini">,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  options: { jsonMode?: boolean; temperature?: number; maxOutputTokens?: number; signal?: AbortSignal },
): Promise<string> {
  const key = getProviderKeys()[id];
  if (!key) throw new Error(`No ${PROVIDER_LABELS[id]} API key configured.`);
  const response = await fetch(`${PROVIDER_BASE_URLS[id]}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: modelFor(id),
      messages,
      ...(options.jsonMode ? { response_format: { type: "json_object" } } : {}),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.maxOutputTokens !== undefined ? { max_tokens: options.maxOutputTokens } : {}),
    }),
    signal: options.signal,
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 400);
    throw new Error(`${PROVIDER_LABELS[id]} HTTP ${response.status}: ${detail || "(no body)"}`);
  }
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return (data.choices?.[0]?.message?.content ?? "").trim();
}

/**
 * One model turn with tool support, running across the provider fallback
 * chain. Gemini uses native function calling; the OpenAI-compatible
 * providers use the strict JSON tool protocol.
 */
export async function generateTurnWithToolsFallback(options: {
  contents: GeminiStyleContents;
  systemInstruction: string;
  tools: ToolDeclaration[];
  signal?: AbortSignal;
}): Promise<ToolAwareTurn & { provider: ProviderId }> {
  const order = availableProviderOrder();
  if (!order.length) {
    throw new Error(
      "No model API key is available. Add a Gemini, Groq, DeepSeek or OpenAI key in AMAYRA's API Keys settings.",
    );
  }
  let lastError = "";
  for (let i = 0; i < order.length; i += 1) {
    const id = order[i];
    if (options.signal?.aborted) throw new Error("Model call cancelled.");
    try {
      if (id === "gemini") {
        const turn = await generateTurnOnProvider("gemini", options.contents, options.systemInstruction, options.tools);
        markProviderOk(id);
        log("command", `MODEL_TURN_VIA gemini calls=${turn.functionCalls.length}`);
        return { ...turn, provider: id };
      }
      const validTools = new Set(options.tools.map((tool) => tool.name));
      const baseMessages = translateContentsToMessages(
        options.contents,
        `${options.systemInstruction}\n\n${toolProtocolInstruction(options.tools)}`,
      );
      let turn: ToolAwareTurn | null = null;
      for (let attempt = 0; attempt < 2 && !turn; attempt += 1) {
        const messages = [...baseMessages];
        if (attempt > 0) {
          messages.push({
            role: "user",
            content: 'Your previous reply was not valid protocol JSON. Answer again with ONLY {"text":"..."} or {"function_calls":[...]}.',
          });
        }
        const raw = await generateChatMessages(id, messages, { jsonMode: true, temperature: 0.6, signal: options.signal });
        turn = parseToolProtocolReply(raw, validTools);
      }
      if (!turn) throw new Error("Tool protocol: no valid reply after retry.");
      markProviderOk(id);
      if (i > 0) log("command", `PROVIDER_FALLBACK_USED ${order[0]}→${id}`);
      log("command", `MODEL_TURN_VIA ${id} calls=${turn.functionCalls.length}`);
      return { ...turn, provider: id };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (options.signal?.aborted) throw new Error("Model call cancelled.");
      const next = order[i + 1];
      if (isQuotaError(lastError) || isAuthError(lastError)) {
        markProviderExhausted(id, lastError.slice(0, 200));
      } else {
        log("error", `PROVIDER_FAILED ${id}: ${lastError.slice(0, 200)}`);
      }
      if (next) log("error", `PROVIDER_FALLBACK ${id}→${next}`);
    }
  }
  throw new Error(`All model providers failed. Last error: ${lastError}`);
}
