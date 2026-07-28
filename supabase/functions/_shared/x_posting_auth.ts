// deno-lint-ignore-file no-explicit-any
import {
  createXOAuth1AuthorizationHeader,
  loadXOAuth1Credentials,
} from "./x_oauth1.ts";
import { getXAccessToken, refreshXToken } from "./x_tokens.ts";

export type XBotPostAuthMode = "oauth1" | "oauth2";

type EnvReader = (name: string) => string | undefined;

export function loadXBotPostAuthMode(
  readEnv: EnvReader = (name) => Deno.env.get(name),
): XBotPostAuthMode {
  const mode = String(readEnv("X_BOT_POST_AUTH_MODE") ?? "")
    .trim()
    .toLowerCase();
  if (mode !== "oauth1" && mode !== "oauth2") {
    throw new Error(
      "X_BOT_POST_AUTH_MODE must be configured as oauth1 or oauth2",
    );
  }
  return mode;
}

export async function xPostingAuthorization(
  admin: any,
  request: { method: string; url: string },
  options: {
    mode?: XBotPostAuthMode;
    oauth2TokenLoader?: (admin: any) => Promise<{ accessToken: string }>;
  } = {},
): Promise<{ authorization: string; mode: XBotPostAuthMode }> {
  const mode = options.mode ?? loadXBotPostAuthMode();
  if (mode === "oauth1") {
    return {
      authorization: await createXOAuth1AuthorizationHeader({
        method: request.method,
        url: request.url,
        credentials: loadXOAuth1Credentials(),
      }),
      mode,
    };
  }

  const token = await (options.oauth2TokenLoader ?? getXAccessToken)(admin);
  return { authorization: `Bearer ${token.accessToken}`, mode };
}

export async function refreshOAuth2PostingAuthorization(
  admin: any,
): Promise<void> {
  await refreshXToken(admin, { force: true, refreshWithinMs: 0 });
}
