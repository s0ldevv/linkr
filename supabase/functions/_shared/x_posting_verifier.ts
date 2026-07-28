import { loadExpectedXBotIdentity } from "./x_bot_identity.ts";
import {
  createXOAuth1AuthorizationHeader,
  loadXOAuth1Credentials,
} from "./x_oauth1.ts";

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
  authMode: "oauth1";
  xUserId: string;
  botHandle: string;
  verifiedAt: string;
}

function safeBodyMessage(body: unknown, max = 500): string {
  const object = body && typeof body === "object"
    ? (body as Record<string, unknown>)
    : {};
  const candidates = [
    object.title,
    object.detail,
    object.error,
    object.error_description,
  ];
  const message = candidates.find((value) => typeof value === "string");
  return typeof message === "string"
    ? message.slice(0, max)
    : "X rejected the credentials";
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
  fetchImpl: typeof fetch = fetch,
): Promise<XPostingVerificationResult> {
  let authorization: string;
  let expected: ReturnType<typeof loadExpectedXBotIdentity>;
  try {
    expected = loadExpectedXBotIdentity();
    authorization = await createXOAuth1AuthorizationHeader({
      method: "GET",
      url: X_ME_URL,
      credentials: loadXOAuth1Credentials(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new XPostingVerificationError(
      "oauth1_credentials_missing",
      503,
      message,
    );
  }

  let response: Response;
  try {
    response = await fetchImpl(X_ME_URL, {
      headers: { Authorization: authorization },
    });
  } catch (_) {
    throw new XPostingVerificationError(
      "x_auth_network_error",
      503,
      "X auth check failed",
    );
  }
  const body = (await response.json().catch(() => ({}))) as XMeResponseBody;
  if (!response.ok) {
    throw new XPostingVerificationError(
      "x_auth_rejected",
      response.status === 401 || response.status === 403
        ? response.status
        : 502,
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
    authMode: "oauth1",
    xUserId: actualId,
    botHandle: actualHandle,
    verifiedAt: new Date().toISOString(),
  };
}
