export interface XBotIdentity {
  userId: string;
  handle: string;
}

type EnvReader = (name: string) => string | undefined;

export function normalizeXBotHandle(value: string): string {
  return value.trim().replace(/^@+/, "").toLowerCase();
}

export function loadExpectedXBotIdentity(
  readEnv: EnvReader = (name) => Deno.env.get(name),
): XBotIdentity {
  const userId = String(readEnv("X_BOT_USER_ID") ?? "").trim();
  if (!/^\d+$/.test(userId)) throw new Error("X_BOT_USER_ID is not configured correctly");

  const handle = normalizeXBotHandle(String(readEnv("X_BOT_HANDLE") ?? ""));
  if (handle !== "linkrcash") throw new Error("X_BOT_HANDLE is not configured correctly");
  return { userId, handle };
}
