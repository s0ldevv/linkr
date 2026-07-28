import { loadConversationThread } from "./conversation.ts";
import type { LinkrWorldState } from "./linkr_types.ts";

export async function loadLinkrWorldState(args: {
  admin: any;
  tw: Record<string, unknown>;
  profile: Record<string, unknown> | null;
  wallet: Record<string, unknown> | null;
  user_context: Record<string, unknown>;
  thread_context: Record<string, unknown> | null;
}): Promise<LinkrWorldState> {
  const conversationId = String(args.tw.conversation_id ?? "") || null;
  const conversation = await loadConversationThread(args.admin, conversationId, 12);
  const activeState = await loadConversationState(
    args.admin,
    conversationId,
    String(args.tw.author_twitter_id ?? ""),
  );
  return {
    tweet: args.tw,
    profile: args.profile,
    wallet: args.wallet,
    user_context: args.user_context,
    thread_context: args.thread_context,
    conversation: {
      conversation_id: conversation.conversation_id,
      messages: conversation.messages as unknown as Array<Record<string, unknown>>,
      total_count: conversation.total_count,
    },
    active_state: activeState,
  };
}

async function loadConversationState(
  admin: any,
  conversationId: string | null,
  participantTwitterId: string,
) {
  if (!conversationId || !participantTwitterId) return null;
  const { data } = await admin
    .from("linkr_conversation_state")
    .select("*")
    .eq("conversation_id", conversationId)
    .eq("participant_twitter_id", participantTwitterId)
    .maybeSingle();
  return data ?? null;
}
