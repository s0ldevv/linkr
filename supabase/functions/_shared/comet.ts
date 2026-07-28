// deno-lint-ignore-file no-explicit-any
// CometAPI client (OpenAI-compatible). Used for classification, extraction, and replies.

const COMET_BASE_URL = "https://api.cometapi.com/v1";
const RETRYABLE_STATUSES = new Set([
  408,
  409,
  425,
  429,
  500,
  502,
  503,
  504,
  524,
  529,
]);
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_STREAM_TIMEOUT_MS = 120_000;
const MAX_ERROR_BODY_BYTES = 64 * 1024;
const MAX_SSE_BUFFER_BYTES = 1024 * 1024;
const DEFAULT_ATTEMPTS_PER_MODEL = 3;

export class CometAPIError extends Error {
  status: number | null;
  body: string;
  model: string;
  retryable: boolean;

  constructor(
    args: {
      status: number | null;
      body: string;
      model: string;
      retryable: boolean;
    },
  ) {
    super(
      args.status == null
        ? `CometAPI request failed for ${args.model}: ${args.body}`
        : `CometAPI error ${args.status} for ${args.model}: ${args.body}`,
    );
    this.name = "CometAPIError";
    this.status = args.status;
    this.body = args.body;
    this.model = args.model;
    this.retryable = args.retryable;
  }
}

type CometInput = string | Array<Record<string, unknown>>;

export async function callCometResponses({
  model,
  models,
  input,
  reasoning,
  timeoutMs,
  attemptsPerModel: attemptsPerModelOverride,
}: {
  model?: string;
  models?: string[];
  input: CometInput;
  reasoning?: { effort: "none" | "low" | "medium" | "high" };
  // Optional per-call overrides for latency-sensitive (hot-path) callers. When
  // omitted, behavior is identical to the env-driven defaults (COMET_TIMEOUT_MS /
  // COMET_ATTEMPTS_PER_MODEL), so existing callers are unaffected.
  timeoutMs?: number;
  attemptsPerModel?: number;
}): Promise<any> {
  const key = Deno.env.get("COMET_API_KEY");
  if (!key) throw new Error("COMET_API_KEY missing");

  const modelList = normalizeModels(models ?? (model ? [model] : []));
  if (modelList.length === 0) throw new Error("Comet model missing");

  const attemptsPerModel =
    attemptsPerModelOverride && attemptsPerModelOverride > 0
      ? Math.floor(attemptsPerModelOverride)
      : readPositiveInt("COMET_ATTEMPTS_PER_MODEL", DEFAULT_ATTEMPTS_PER_MODEL);
  let lastError: unknown = null;

  for (const candidate of modelList) {
    for (let attempt = 0; attempt < attemptsPerModel; attempt++) {
      try {
        const res = await fetchWithTimeout(`${COMET_BASE_URL}/responses`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: candidate,
            input,
            ...(reasoning ? { reasoning } : {}),
          }),
        }, timeoutMs);

        if (res.ok) return await res.json();

        const body = await readBoundedResponseText(res, MAX_ERROR_BODY_BYTES);
        const retryable = RETRYABLE_STATUSES.has(res.status);
        const error = new CometAPIError({
          status: res.status,
          body,
          model: candidate,
          retryable,
        });
        lastError = error;
        if (!retryable) throw error;
        if (attempt < attemptsPerModel - 1) {
          await sleep(backoffMs(attempt, res.headers));
        }
      } catch (error) {
        lastError = normalizeFetchError(error, candidate);
        if (!isRetryableCometError(lastError)) throw lastError;
        if (attempt >= attemptsPerModel - 1) break;
        await sleep(backoffMs(attempt));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function callCometResponsesStream({
  model,
  models,
  input,
  reasoning,
  onTextDelta,
  timeoutMs,
}: {
  model?: string;
  models?: string[];
  input: CometInput;
  reasoning?: { effort: "none" | "low" | "medium" | "high" };
  onTextDelta?: (delta: string, accumulated: string) => void | Promise<void>;
  timeoutMs?: number;
}): Promise<{ response: any; text: string; model: string }> {
  const key = Deno.env.get("COMET_API_KEY");
  if (!key) throw new Error("COMET_API_KEY missing");

  const modelList = normalizeModels(models ?? (model ? [model] : []));
  if (modelList.length === 0) throw new Error("Comet model missing");

  const attemptsPerModel = readPositiveInt(
    "COMET_ATTEMPTS_PER_MODEL",
    DEFAULT_ATTEMPTS_PER_MODEL,
  );
  const streamTimeoutMs = timeoutMs && timeoutMs > 0
    ? Math.floor(timeoutMs)
    : readPositiveInt("COMET_STREAM_TIMEOUT_MS", DEFAULT_STREAM_TIMEOUT_MS);
  let lastError: unknown = null;

  for (const candidate of modelList) {
    for (let attempt = 0; attempt < attemptsPerModel; attempt++) {
      let emittedText = false;
      try {
        const res = await fetchWithTimeout(`${COMET_BASE_URL}/responses`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: candidate,
            input,
            stream: true,
            ...(reasoning ? { reasoning } : {}),
          }),
        }, streamTimeoutMs);

        if (res.ok) {
          return await readStreamingResponse(
            res,
            candidate,
            async (delta, accumulated) => {
              emittedText = true;
              await onTextDelta?.(delta, accumulated);
            },
          );
        }

        const body = await readBoundedResponseText(res, MAX_ERROR_BODY_BYTES);
        const retryable = RETRYABLE_STATUSES.has(res.status);
        const error = new CometAPIError({
          status: res.status,
          body,
          model: candidate,
          retryable,
        });
        lastError = error;
        if (!retryable) throw error;
        if (attempt < attemptsPerModel - 1) {
          await sleep(backoffMs(attempt, res.headers));
        }
      } catch (error) {
        lastError = normalizeFetchError(error, candidate);
        // Once visible output has been emitted, retrying another request can
        // duplicate text or repeat side effects. Preserve exactly-once UX.
        if (emittedText || !isRetryableCometError(lastError)) throw lastError;
        if (attempt >= attemptsPerModel - 1) break;
        await sleep(backoffMs(attempt));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function extractOutputText(response: any): string {
  if (response?.output_text) return String(response.output_text);
  if (Array.isArray(response?.output)) {
    return response.output
      .flatMap((item: any) => item.content || [])
      .map((c: any) => c.text || "")
      .join("\n")
      .trim();
  }
  if (response?.choices?.[0]?.message?.content) {
    return String(response.choices[0].message.content);
  }
  return "";
}

export function parseStrictJson(text: string): any {
  const cleaned = text
    .trim()
    .replace(/^```json/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();
  return JSON.parse(cleaned);
}

export function isRetryableCometError(error: unknown): boolean {
  return error instanceof CometAPIError ? error.retryable : false;
}

function normalizeModels(models: string[]) {
  const normalized = [...new Set(models.map((m) => m.trim()).filter(Boolean))]
    .filter((model) => !isDisallowedModel(model));
  return normalized.length ? normalized : ["gpt-5-mini"];
}

function isDisallowedModel(model: string): boolean {
  return /\bgpt-5(?:\.\d+)?-nano\b/i.test(model);
}

async function readStreamingResponse(
  res: Response,
  model: string,
  onTextDelta?: (delta: string, accumulated: string) => void | Promise<void>,
): Promise<{ response: any; text: string; model: string }> {
  if (!res.body) throw new Error("Comet stream missing response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let pendingCarriageReturn = false;
  let text = "";
  let completedResponse: any = null;

  const normalizeChunk = (chunk: string, final = false) => {
    let value = (pendingCarriageReturn ? "\r" : "") + chunk;
    pendingCarriageReturn = false;
    if (!final && value.endsWith("\r")) {
      pendingCarriageReturn = true;
      value = value.slice(0, -1);
    }
    return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  };

  const processBlock = async (block: string) => {
    const lines = block.split("\n");
    let event = "";
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    const raw = dataLines.join("\n").trim();
    if (!raw || raw === "[DONE]") return;

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    const type = String(parsed?.type ?? event ?? "");
    if (type === "error" || parsed?.error) {
      const message = parsed?.error?.message ?? parsed?.message ?? raw;
      throw new CometAPIError({
        status: null,
        body: String(message).slice(0, MAX_ERROR_BODY_BYTES),
        model,
        retryable: true,
      });
    }

    if (
      type === "response.output_text.delta" ||
      type === "response.text.delta" ||
      event === "response.output_text.delta"
    ) {
      const delta = String(parsed?.delta ?? parsed?.text ?? "");
      if (delta) {
        text += delta;
        await onTextDelta?.(delta, text);
      }
      return;
    }

    if (
      type === "response.completed" ||
      type === "response.done" ||
      event === "response.completed"
    ) {
      completedResponse = parsed?.response ?? parsed;
      if (!text.trim()) text = extractOutputText(completedResponse);
      return;
    }

    if (!text.trim() && parsed?.output_text) {
      text = String(parsed.output_text);
    }
  };

  const drainBlocks = async () => {
    if (buffer.length > MAX_SSE_BUFFER_BYTES) {
      throw new Error("comet_sse_event_too_large");
    }
    let index = buffer.indexOf("\n\n");
    while (index >= 0) {
      const block = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      await processBlock(block);
      index = buffer.indexOf("\n\n");
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += normalizeChunk(decoder.decode(value, { stream: true }));
    await drainBlocks();
  }
  buffer += normalizeChunk(decoder.decode(), true);
  await drainBlocks();
  const tail = buffer.trim();
  if (tail) await processBlock(tail);

  return { response: completedResponse, text: text.trim(), model };
}

async function readBoundedResponseText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let output = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      const allowed = Math.max(0, value.byteLength - (total - maxBytes));
      if (allowed > 0) {
        output += decoder.decode(value.slice(0, allowed), { stream: true });
      }
      await reader.cancel("response_body_too_large").catch(() => {});
      output += "…";
      break;
    }
    output += decoder.decode(value, { stream: true });
  }
  output += decoder.decode();
  return output;
}

function readPositiveInt(name: string, fallback: number) {
  const raw = Number(Deno.env.get(name));
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  overrideMs?: number,
) {
  const timeoutMs = overrideMs && overrideMs > 0
    ? Math.floor(overrideMs)
    : readPositiveInt("COMET_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeFetchError(error: unknown, model: string) {
  if (error instanceof CometAPIError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new CometAPIError({
    status: null,
    body: message,
    model,
    retryable: true,
  });
}

function backoffMs(attempt: number, headers?: Headers) {
  const retryAfter = headers?.get("retry-after");
  const retryAfterSeconds = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(60_000, retryAfterSeconds * 1000);
  }
  const base = Math.min(30_000, 1000 * 2 ** attempt);
  return base + Math.floor(Math.random() * 500);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
