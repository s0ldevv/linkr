import { loadExpectedXBotIdentity } from "./x_bot_identity.ts";
import { loadXBotPostAuthMode, xPostingAuthorization } from "./x_posting_auth.ts";

const X_ME_URL = "https://api.x.com/2/users/me?user.fields=username";

export class XPostingVerificationError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "XPostingVerificationError";
  }
}

export interface XPostingVerificationResult {
  success: true;
  authMode: "oauth1" | "oauth2";
  xUserId: string;
  botHandle: string;
  verifiedAt: string;
}

export interface XPostingVerifierOptions {
  admin?: any;
  fetchImpl?: typeof fetch;
  oauth2TokenLoader?: (admin: any) => Promise<{ accessToken: string }>;
}

function safeBodyMessage(body: unknown, max = 500): string {
  const object = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const candidates = [object.title, object.detail, object.error, object.error_description];
  const message = candidates.find((value) => typeof value === "string");
  return typeof message === "string" ? message.slice(0, max) : "X rejected the credentials";
}

interface XMeResponseBody {
  data?: {
    id?: unknown;
    username?: unknown;
  };
  title?: unknown;
  detail?: unknown;
  error?: unknown;
  error_description?: unknown;
}

export async function verifyXPostingCredentials(
  optionsOrFetch: XPostingVerifierOptions | typeof fetch = {},
): Promise<XPostingVerificationResult> {
  const options =
    typeof optionsOrFetch === "function" ? { fetchImpl: optionsOrFetch } : optionsOrFetch;
  const fetchImpl = options.fetchImpl ?? fetch;
  let authMode: "oauth1" | "oauth2";
  let authorization = "";
  let expected: ReturnType<typeof loadExpectedXBotIdentity>;
  try {
    expected = loadExpectedXBotIdentity();
    authMode = loadXBotPostAuthMode();
    authorization = (
      await xPostingAuthorization(
        options.admin,
        { method: "GET", url: X_ME_URL },
        { mode: authMode, oauth2TokenLoader: options.oauth2TokenLoader },
      )
    ).authorization;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new XPostingVerificationError("x_posting_credentials_missing", 503, message);
  }

  let response: Response;
  try {
    response = await fetchImpl(X_ME_URL, {
      headers: { Authorization: authorization },
    });
  } catch (_) {
    throw new XPostingVerificationError("x_auth_network_error", 503, "X auth check failed");
  }
  const body = (await response.json().catch(() => ({}))) as XMeResponseBody;
  if (!response.ok) {
    throw new XPostingVerificationError(
      "x_auth_rejected",
      response.status === 401 || response.status === 403 ? response.status : 502,
      `X auth check ${response.status}: ${safeBodyMessage(body)}`,
    );
  }

  const actualId = String(body?.data?.id ?? "").trim();
  const actualHandle = String(body?.data?.username ?? "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
  if (actualId !== expected.userId || actualHandle !== expected.handle) {
    throw new XPostingVerificationError(
      "x_identity_mismatch",
      409,
      `X credentials identify @${actualHandle || "unknown"} (${
        actualId || "unknown"
      }), not the configured bot`,
    );
  }

  return {
    success: true,
    authMode,
    xUserId: actualId,
    botHandle: actualHandle,
    verifiedAt: new Date().toISOString(),
  };
}
