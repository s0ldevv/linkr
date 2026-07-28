export type IngestSourceName = "mention" | "reply_to_bot";

export interface InboxSearchSource {
  cursorKey: string;
  legacyCursorKeys: readonly string[];
  query: string;
  botHandle: string;
  replyToBotScanEnabled: boolean;
  requireKnownParentReply: boolean;
}

export interface SearchSourceFlags {
  replyToBotScanEnabled?: boolean;
  replyToBotRequireKnownParent?: boolean;
}

export interface FollowUpLike {
  isFollowUp: boolean;
}

export interface IngestDecision {
  shouldIngest: boolean;
  source: IngestSourceName;
  reason: string;
}

const COMBINED_CURSOR_KEY = "x_inbox_since_id_v2";
const LEGACY_CURSOR_KEYS = [
  "x_mentions_since_id",
  "x_replies_to_bot_since_id",
] as const;

export function buildInboxSearchSource(
  botHandle: string,
  flags: SearchSourceFlags = {},
): InboxSearchSource {
  const normalizedHandle = botHandle.replace(/^@+/, "").trim().toLowerCase();
  const replyToBotScanEnabled = flags.replyToBotScanEnabled ?? true;

  return {
    cursorKey: replyToBotScanEnabled
      ? COMBINED_CURSOR_KEY
      : LEGACY_CURSOR_KEYS[0],
    legacyCursorKeys: replyToBotScanEnabled ? LEGACY_CURSOR_KEYS : [],
    query: replyToBotScanEnabled
      ? `(@${normalizedHandle} OR to:${normalizedHandle}) -from:${normalizedHandle}`
      : `@${normalizedHandle} -from:${normalizedHandle}`,
    botHandle: normalizedHandle,
    replyToBotScanEnabled,
    requireKnownParentReply: flags.replyToBotRequireKnownParent ?? true,
  };
}

export function decideInboxIngest(
  source: InboxSearchSource,
  tweetText: string,
  followUp: FollowUpLike,
): IngestDecision {
  // Preserve the legacy precedence: an explicit mention was always handled by the
  // mention search before the reply-to-bot search could see the same tweet.
  if (mentionsBotHandle(tweetText, source.botHandle)) {
    return { shouldIngest: true, source: "mention", reason: "direct_mention" };
  }

  if (
    source.replyToBotScanEnabled &&
    (followUp.isFollowUp || !source.requireKnownParentReply)
  ) {
    return {
      shouldIngest: true,
      source: "reply_to_bot",
      reason: followUp.isFollowUp
        ? "reply_to_known_linkr_reply"
        : "reply_to_linkr_account_unknown_parent",
    };
  }

  return {
    shouldIngest: false,
    source: "reply_to_bot",
    reason: "unknown_parent",
  };
}

export function isDuplicateTweetId(
  tweetId: string,
  existingTweetIds: Set<string>,
  seenTweetIds: Set<string>,
): boolean {
  return existingTweetIds.has(tweetId) || seenTweetIds.has(tweetId);
}

export function normalizeSinceId(value: unknown): string | undefined {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id || id === "0" || !/^\d+$/.test(id)) return undefined;
  return id;
}

export function oldestSinceId(values: unknown[]): string | undefined {
  const valid = values.map(normalizeSinceId).filter((value): value is string =>
    !!value
  );
  return valid.reduce<string | undefined>(
    (oldest, value) =>
      !oldest || BigInt(value) < BigInt(oldest) ? value : oldest,
    undefined,
  );
}

export function isInvalidSinceIdError(body: string): boolean {
  return body.includes('"since_id"') || body.includes("'since_id'");
}

export function buildSeededFlattenedContext(args: {
  parentText: string | null;
  rootText: string | null;
  userText: string;
}) {
  return [
    args.rootText ? `Root post: ${args.rootText}` : null,
    args.parentText ? `Parent post: ${args.parentText}` : null,
    `User post: ${args.userText}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function mentionsBotHandle(text: string, botHandle: string): boolean {
  const escapedHandle = botHandle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_])@${escapedHandle}(?![A-Za-z0-9_])`, "i")
    .test(text);
}
