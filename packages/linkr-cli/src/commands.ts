import { deleteCredentials, requireCredentials } from "./config.js";
import { signedJson } from "./api.js";
import { login } from "./auth.js";
import { runChat } from "./chat.js";

export async function loginCommand(options: {
  apiUrl?: string;
  full?: boolean;
  readOnly?: boolean;
  noBrowser?: boolean;
}) {
  await login(options);
}

export async function logoutCommand() {
  await deleteCredentials();
  console.log("Logged out locally.");
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
  await signedJson(
    credentials,
    "POST",
    "/api/cli/revoke-current",
    {},
    {
      idempotencyKey: `cli-revoke:${credentials.keyPrefix}`,
    },
  );
  await deleteCredentials();
  console.log("Revoked current CLI key and removed local credentials.");
}
