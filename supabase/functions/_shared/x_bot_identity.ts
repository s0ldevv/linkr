export interface XBotIdentity {
  userId: string;
  handle: string;
}

export const DEFAULT_X_BOT_HANDLE = "linkrcash";
export const LEGACY_X_BOT_HANDLES = ["linkrbot"] as const;

type EnvReader = (name: string) => string | undefined;

export function normalizeXBotHandle(value: string): string {
  return value.trim().replace(/^@+/, "").toLowerCase();
}

export function isLinkrBotHandle(
  value: string,
  configuredHandle = DEFAULT_X_BOT_HANDLE,
): boolean {
  const handle = normalizeXBotHandle(value);
  const configured = normalizeXBotHandle(configuredHandle);
  return handle === configured ||
    handle === DEFAULT_X_BOT_HANDLE ||
    (LEGACY_X_BOT_HANDLES as readonly string[]).includes(handle);
}

export function loadExpectedXBotIdentity(
  readEnv: EnvReader = (name) => Deno.env.get(name),
): XBotIdentity {
  const userId = String(readEnv("X_BOT_USER_ID") ?? "").trim();
  if (!/^\d+$/.test(userId)) {
    throw new Error("X_BOT_USER_ID is not configured correctly");
  }

  const handle = normalizeXBotHandle(String(readEnv("X_BOT_HANDLE") ?? ""));
  if (!/^[a-z0-9_]{1,15}$/.test(handle)) {
    throw new Error("X_BOT_HANDLE is not configured correctly");
  }
  return { userId, handle };
}
