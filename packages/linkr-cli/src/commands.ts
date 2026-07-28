import {
  credentialsPath,
  deleteCredentials,
  readCredentials,
  requireCredentials,
  type LinkrCredentials,
} from "./config.js";
import { signedJson } from "./api.js";
import { login } from "./auth.js";
import { runChat } from "./chat.js";
import { resolveApiUrl } from "./api-url.js";
import { VERSION } from "./version.js";

export async function loginCommand(options: {
  apiUrl?: string;
  full?: boolean;
  readOnly?: boolean;
  noBrowser?: boolean;
}) {
  await login(options);
}

export async function logoutCommand(options: { revoke?: boolean } = {}) {
  if (options.revoke) {
    const credentials = await requireCredentials();
    await revokeCredentials(credentials);
    await deleteCredentials();
    console.log("Revoked current CLI key and logged out.");
    return;
  }

  await deleteCredentials();
  console.log("Logged out locally. Server-side CLI keys are unchanged.");
  console.log("Use linkr revoke-current when you want to revoke a key before logging out.");
}

export async function doctorCommand(options: { apiUrl?: string }) {
  const apiResolution = resolveApiUrl({ apiUrl: options.apiUrl, env: process.env });
  console.log(`Linkr CLI: ${VERSION}`);
  console.log(`Node: ${process.version}`);
  console.log(`Platform: ${process.platform} ${process.arch}`);
  console.log(
    `API URL: ${apiResolution.apiUrl}${
      apiResolution.normalizedFrom ? ` (normalized from ${apiResolution.normalizedFrom})` : ""
    }`,
  );
  console.log(`LINKR_API_URL: ${process.env.LINKR_API_URL ? "set" : "not set"}`);
  console.log(`Credentials path: ${credentialsPath()}`);

  let credentialReadError: unknown;
  const credentials = await readCredentials().catch((error) => {
    credentialReadError = error;
    return null;
  });
  if (credentialReadError) {
    console.log(
      `Credentials: unreadable (${credentialReadError instanceof Error ? credentialReadError.message : String(credentialReadError)})`,
    );
  } else if (credentials) {
    console.log(`Credentials: present (${credentials.keyPrefix})`);
  } else {
    console.log("Credentials: not found");
  }

  const route = await probeLoginRoute(apiResolution.apiUrl);
  console.log(`Login route: ${route}`);
}

export async function whoamiCommand() {
  const credentials = await requireCredentials();
  const data = await signedJson<any>(credentials, "GET", "/api/me");
  console.log(`${data.agent_profile?.name ?? "Linkr CLI"} (${data.key?.prefix ?? "unknown"})`);
  console.log(`Wallet: ${data.wallet?.address ?? "unknown"}`);
  console.log(`Scopes: ${(data.key?.scopes ?? []).join(", ")}`);
}

export async function chatCommand(
  message: string | undefined,
  options: {
    conversation?: string;
    image?: string[];
    imageUrl?: string[];
  },
) {
  const credentials = await requireCredentials();
  await runChat(credentials, {
    message,
    conversation: options.conversation,
    images: options.image,
    imageUrls: options.imageUrl,
  });
}

export async function conversationsCommand() {
  const credentials = await requireCredentials();
  const data = await signedJson<{ conversations: Array<any> }>(
    credentials,
    "GET",
    "/api/cli/conversations",
  );
  for (const conversation of data.conversations) {
    const title = conversation.title ?? "Untitled";
    const preview = conversation.last_message_preview ?? "";
    console.log(`${conversation.id}  ${title}${preview ? ` - ${preview}` : ""}`);
  }
}

export async function continueCommand(conversationId: string) {
  const credentials = await requireCredentials();
  await runChat(credentials, { conversation: conversationId });
}

export async function revokeCurrentCommand() {
  const credentials = await requireCredentials();
  await revokeCredentials(credentials);
  await deleteCredentials();
  console.log("Revoked current CLI key and removed local credentials.");
}

async function revokeCredentials(credentials: LinkrCredentials) {
  await signedJson(credentials, "POST", "/api/cli/revoke-current", {}, {
    idempotencyKey: `cli-revoke:${credentials.keyPrefix}`,
  });
}

async function probeLoginRoute(apiUrl: string): Promise<string> {
  try {
    const response = await fetch(`${apiUrl}/api/cli/auth/start`, {
      method: "GET",
      headers: { "X-Linkr-Client-Version": VERSION },
    });
    const payload = (await response.json().catch(() => ({}))) as {
      error?: { code?: string };
      code?: string;
    };
    const code = payload.error?.code ?? payload.code;
    if (response.status === 405) return "reachable";
    if (response.status === 404 && code === "api_route_not_found") {
      return "missing (check API URL)";
    }
    if (response.status < 500) return `reachable (${response.status})`;
    return `server error (${response.status})`;
  } catch (error) {
    return `unreachable (${error instanceof Error ? error.message : String(error)})`;
  }
}
