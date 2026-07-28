export const AUTH_POPUP_RESULT_KEY = "linkr:auth-popup-result:v1";

const AUTH_POPUP_PENDING_KEY = "linkr:auth-popup-pending:v1";
const AUTH_POPUP_CHANNEL = "linkr:auth-popup:v1";
const AUTH_POPUP_MAX_AGE_MS = 10 * 60 * 1000;

export type AuthPopupResult = {
  type: "linkr:auth";
  status: "ok" | "error" | "banned";
  message: string | null;
  flowId: string | null;
  userId: string | null;
  // Export reauthentication hands the short-lived, single-use exchange code
  // back to the opener. These values are deliberately omitted from storage.
  handoffCode?: string | null;
  handoffRedirectTo?: string | null;
};

type PendingAuthPopup = {
  flowId: string;
  createdAt: number;
};

export function createAuthFlowId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function beginAuthPopupFlow(flowId: string): void {
  writeJson(AUTH_POPUP_PENDING_KEY, { flowId, createdAt: Date.now() });
  removeLocalValue(AUTH_POPUP_RESULT_KEY);
}

export function clearAuthPopupFlow(flowId?: string | null): void {
  const pending = readPendingAuthPopupFlow();
  if (!flowId || !pending || pending.flowId === flowId) {
    removeLocalValue(AUTH_POPUP_PENDING_KEY);
  }
  const result = readAuthPopupResult(readLocalValue(AUTH_POPUP_RESULT_KEY));
  if (!flowId || !result?.flowId || result.flowId === flowId) {
    removeLocalValue(AUTH_POPUP_RESULT_KEY);
  }
}

export function readPendingAuthPopupFlow(): PendingAuthPopup | null {
  const pending = readJson<PendingAuthPopup>(readLocalValue(AUTH_POPUP_PENDING_KEY));
  if (
    !pending ||
    typeof pending.flowId !== "string" ||
    !pending.flowId ||
    typeof pending.createdAt !== "number" ||
    Date.now() - pending.createdAt > AUTH_POPUP_MAX_AGE_MS
  ) {
    if (pending) removeLocalValue(AUTH_POPUP_PENDING_KEY);
    return null;
  }
  return pending;
}

export function publishAuthPopupResult(result: AuthPopupResult): void {
  try {
    window.opener?.postMessage(result, window.location.origin);
  } catch {
    // Cross-origin isolation can sever the opener; storage/channel delivery remains available.
  }
  // Persist only non-sensitive results. Wallet-export handoff codes stay
  // in-memory and are delivered through postMessage/BroadcastChannel only.
  const persistedResult: AuthPopupResult = {
    type: result.type,
    status: result.status,
    message: result.message,
    flowId: result.flowId,
    userId: result.userId,
  };
  if (!result.handoffCode) writeJson(AUTH_POPUP_RESULT_KEY, persistedResult);

  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(AUTH_POPUP_CHANNEL);
    channel.postMessage(result);
    channel.close();
  }
}

export function readAuthPopupResultForFlow(flowId: string): AuthPopupResult | null {
  const result = readAuthPopupResult(readLocalValue(AUTH_POPUP_RESULT_KEY));
  return result?.flowId === flowId ? result : null;
}

export function subscribeToAuthPopupResults(
  onResult: (result: AuthPopupResult) => void,
): () => void {
  const onMessage = (event: MessageEvent) => {
    if (event.origin !== window.location.origin) return;
    const result = parseAuthPopupResult(event.data);
    if (result) onResult(result);
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== AUTH_POPUP_RESULT_KEY || !event.newValue) return;
    const result = readAuthPopupResult(event.newValue);
    if (result) onResult(result);
  };
  const channel =
    typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(AUTH_POPUP_CHANNEL) : null;
  if (channel) {
    channel.onmessage = (event) => {
      const result = parseAuthPopupResult(event.data);
      if (result) onResult(result);
    };
  }

  window.addEventListener("message", onMessage);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener("message", onMessage);
    window.removeEventListener("storage", onStorage);
    channel?.close();
  };
}

function parseAuthPopupResult(value: unknown): AuthPopupResult | null {
  if (!value || typeof value !== "object") return null;
  const result = value as Partial<AuthPopupResult>;
  if (result.type !== "linkr:auth" || !["ok", "error", "banned"].includes(String(result.status))) {
    return null;
  }
  return {
    type: "linkr:auth",
    status: result.status as AuthPopupResult["status"],
    message: typeof result.message === "string" ? result.message : null,
    flowId: typeof result.flowId === "string" ? result.flowId : null,
    userId: typeof result.userId === "string" ? result.userId : null,
    handoffCode: typeof result.handoffCode === "string" ? result.handoffCode : null,
    handoffRedirectTo:
      typeof result.handoffRedirectTo === "string" ? result.handoffRedirectTo : null,
  };
}

function readAuthPopupResult(value: string | null): AuthPopupResult | null {
  return parseAuthPopupResult(readJson<unknown>(value));
}

function readJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The opener postMessage/BroadcastChannel path still works if storage is unavailable.
  }
}

function readLocalValue(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function removeLocalValue(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Storage may be disabled in hardened/private browser contexts.
  }
}
