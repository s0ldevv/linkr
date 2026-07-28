import { randomUUID } from "node:crypto";
import prompts from "prompts";
import { PendingAction, TerminalAttachment, signedJson, signedStream, uploadImage } from "./api.js";
import { LinkrCredentials } from "./config.js";

export async function runChat(
  credentials: LinkrCredentials,
  options: {
    message?: string;
    conversation?: string;
    images?: string[];
    imageUrls?: string[];
    once?: boolean;
  },
) {
  const attachments = await buildAttachments(credentials, options);
  if (options.message) {
    await sendTurn(credentials, options.message, options.conversation, attachments);
    return;
  }

  let conversationId = options.conversation ?? null;
  while (true) {
    const answer = await prompts({
      type: "text",
      name: "message",
      message: "You",
    });
    const message = String(answer.message ?? "").trim();
    if (!message || ["/exit", "exit", "quit", "/quit"].includes(message.toLowerCase())) break;
    const result = await sendTurn(credentials, message, conversationId, []);
    conversationId = result.conversationId ?? conversationId;
  }
}

async function sendTurn(
  credentials: LinkrCredentials,
  message: string,
  conversationId: string | null | undefined,
  attachments: TerminalAttachment[],
): Promise<{ conversationId: string | null }> {
  let liveConversationId = conversationId ?? null;
  const pendingActions: PendingAction[] = [];
  await signedStream(
    credentials,
    {
      conversation_id: conversationId ?? null,
      client_message_id: randomUUID(),
      message,
      attachments,
      client_context: {
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        route: "linkr-cli",
        selected_chain: "all",
      },
    },
    {
      ack: (payload) => {
        liveConversationId = String(payload.conversation_id ?? liveConversationId ?? "");
      },
      delta: (payload) => {
        const delta = String(payload.delta ?? "");
        if (delta) process.stdout.write(delta);
      },
      message_update: (payload) => {
        const content = String(payload.content ?? "");
        if (content) {
          process.stdout.write(`\r${content}\n`);
        }
      },
      action_required: (payload) => {
        pendingActions.push(payload as PendingAction);
      },
      error: (payload) => {
        const text = String(payload.message ?? "Linkr hit an error.");
        process.stdout.write(`\nLinkr: ${text}\n`);
      },
      complete: () => {
        process.stdout.write("\n");
      },
    },
  );

  for (const action of pendingActions) {
    await handlePendingAction(credentials, action);
  }
  return { conversationId: liveConversationId };
}

async function handlePendingAction(credentials: LinkrCredentials, action: PendingAction) {
  const pending = action.pending_action ?? {};
  const pendingActionId = String(pending.id ?? action.pending_action_id ?? "").trim();
  const confirmationPhrase = String(
    pending.confirmation_phrase ?? action.confirmation_phrase ?? "",
  ).trim();
  if (!pendingActionId || !confirmationPhrase) return;

  console.log("Pending action:");
  console.log(String(pending.summary ?? action.summary ?? "Review this action in Linkr."));
  console.log(`Type exactly: ${confirmationPhrase}`);
  const answer = await prompts({
    type: "text",
    name: "phrase",
    message: "Confirmation phrase, or leave blank to cancel",
  });
  const phrase = String(answer.phrase ?? "").trim();
  if (!phrase) {
    await signedJson(credentials, "POST", "/api/cli/action", {
      pending_action_id: pendingActionId,
      action: "cancel",
    });
    console.log("Cancelled.");
    return;
  }
  const result = await signedJson<{ message?: string }>(
    credentials,
    "POST",
    "/api/cli/action",
    {
      pending_action_id: pendingActionId,
      action: "confirm",
      confirmation_phrase: phrase,
    },
    { idempotencyKey: `cli-confirm:${pendingActionId}:${randomUUID()}` },
  );
  console.log(result.message ?? "Confirmed.");
}

async function buildAttachments(
  credentials: LinkrCredentials,
  options: { images?: string[]; imageUrls?: string[] },
): Promise<TerminalAttachment[]> {
  const attachments: TerminalAttachment[] = [];
  for (const url of options.imageUrls ?? []) {
    attachments.push({ kind: "image", source_url: url });
  }
  for (const imagePath of options.images ?? []) {
    attachments.push(await uploadImage(credentials, imagePath));
  }
  return attachments.slice(0, 4);
}
