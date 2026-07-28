import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { LinkrCredentials } from "./config.js";
import { signRequest } from "./signing.js";
import { VERSION } from "./version.js";

export type TerminalAttachment = {
  kind: "image";
  source_url: string;
  storage_path?: string | null;
  mime_type?: string | null;
  width?: number | null;
  height?: number | null;
  byte_length?: number | null;
};

export type PendingAction = {
  pending_action_id?: string;
  pending_action?: {
    id?: string;
    summary?: string;
    confirmation_phrase?: string;
    action_type?: string;
  };
  summary?: string;
  confirmation_phrase?: string;
};

export class LinkrApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly url?: string,
  ) {
    super(message);
    this.name = "LinkrApiError";
  }
}

export async function unsignedJson<T>(apiUrl: string, path: string, body: unknown): Promise<T> {
  const response = await fetch(`${apiUrl.replace(/\/+$/, "")}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Linkr-Client-Version": VERSION },
    body: JSON.stringify(body),
  });
  return readJsonResponse<T>(response);
}

export async function signedJson<T>(
  credentials: LinkrCredentials,
  method: string,
  apiPath: string,
  body?: unknown,
  options: { idempotencyKey?: string | null } = {},
): Promise<T> {
  const url = new URL(apiPath, credentials.apiUrl);
  const signed = signRequest({
    apiKey: credentials.apiKey,
    method,
    url,
    body,
    idempotencyKey: options.idempotencyKey ?? null,
    clientVersion: VERSION,
    installId: credentials.installId,
  });
  const response = await fetch(url, {
    method,
    headers: signed.headers,
    body: method.toUpperCase() === "GET" ? undefined : signed.body,
  });
  return readJsonResponse<T>(response);
}

export async function signedStream(
  credentials: LinkrCredentials,
  body: unknown,
  handlers: Record<string, (payload: Record<string, unknown>) => void | Promise<void>>,
): Promise<void> {
  const url = new URL("/api/cli/chat", credentials.apiUrl);
  const signed = signRequest({
    apiKey: credentials.apiKey,
    method: "POST",
    url,
    body,
    idempotencyKey: null,
    clientVersion: VERSION,
    installId: credentials.installId,
  });
  const response = await fetch(url, {
    method: "POST",
    headers: { ...signed.headers, Accept: "text/event-stream" },
    body: signed.body,
  });
  if (!response.ok || !response.body) {
    await readJsonResponse(response);
    throw new Error("Linkr stream did not start.");
  }
  await readSse(response.body, handlers);
}

export async function uploadImage(
  credentials: LinkrCredentials,
  filePath: string,
): Promise<TerminalAttachment> {
  const bytes = await readFile(filePath);
  if (bytes.byteLength <= 0 || bytes.byteLength > 4 * 1024 * 1024) {
    throw new Error("Image must be between 1 byte and 4MB.");
  }
  const mimeType = mimeTypeForPath(filePath);
  if (!mimeType) throw new Error("Only PNG, JPG, GIF, and WEBP images are supported.");
  const response = await signedJson<{
    source_url: string;
    storage_path: string | null;
    mime_type: string;
    width: number;
    height: number;
    byte_length: number;
  }>(
    credentials,
    "POST",
    "/api/cli/uploads",
    {
      filename: path.basename(filePath),
      mime_type: mimeType,
      image_base64: bytes.toString("base64"),
    },
    { idempotencyKey: `cli-upload:${randomUUID()}` },
  );
  return {
    kind: "image",
    source_url: response.source_url,
    storage_path: response.storage_path,
    mime_type: response.mime_type,
    width: response.width,
    height: response.height,
    byte_length: response.byte_length,
  };
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = String(payload?.error?.code ?? payload?.error ?? `http_${response.status}`);
    const message = String(payload?.error?.message ?? payload?.message ?? code);
    throw new LinkrApiError(message, code, response.status, response.url || undefined);
  }
  return payload as T;
}

async function readSse(
  body: ReadableStream<Uint8Array>,
  handlers: Record<string, (payload: Record<string, unknown>) => void | Promise<void>>,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminalEventSeen = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    await drain();
  }
  buffer += decoder.decode();
  await drain();
  if (buffer.trim()) await processBlock(buffer.trim());
  if (!terminalEventSeen) throw new Error("Linkr stream ended before completion.");

  async function drain() {
    let index = buffer.indexOf("\n\n");
    while (index >= 0) {
      const block = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      await processBlock(block);
      index = buffer.indexOf("\n\n");
    }
  }

  async function processBlock(block: string) {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (!line || line.startsWith(":")) continue;
      if (line.startsWith("event:")) event = line.slice(6).trim() || "message";
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length === 0) return;
    const payload = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
    if (event === "complete" || event === "error") terminalEventSeen = true;
    await handlers[event]?.(payload);
  }
}

function mimeTypeForPath(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return null;
}
