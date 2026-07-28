// deno-lint-ignore-file no-explicit-any
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import {
  isCronAuthorized,
  unauthorizedCronResponse,
} from "../_shared/cron_auth.ts";
import { withCronLock } from "../_shared/cron_lock.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { extractFromText } from "../_shared/extract.ts";
import { recordHealthEvent } from "../_shared/health.ts";
import { internalErrorResponse } from "../_shared/http.ts";
import { ensureProvisionedXUser } from "../_shared/provisioning.ts";
import { checkIsFollowUp } from "../_shared/conversation.ts";
import { invokeInternalPipelineFunction } from "../_shared/internal_pipeline.ts";
import {
  buildInboxSearchSource,
  buildSeededFlattenedContext,
  decideInboxIngest,
  type InboxSearchSource,
  isDuplicateTweetId,
  isInvalidSinceIdError,
  normalizeSinceId,
  oldestSinceId,
} from "../_shared/x_search_sources.ts";
import { getActiveXBan } from "../_shared/x_bans.ts";
import { evaluateXUserGating } from "../_shared/admin_settings.ts";
import { acceptShadowXPage } from "../_shared/shadow_queue.ts";
import {
  fetchAllXSearchPages,
  oldestFirstXPages,
} from "../_shared/x_pagination.ts";

const BOT_HANDLE = "linkrcash";
const X_API = "https://api.twitter.com/2/tweets/search/recent";

// Detection latency is the first term in the end-to-end budget. pg_cron cannot
// schedule faster than once per minute, so a single invocation performs several
// evenly spaced passes inside that minute (default 4 passes ≈ every 15s) using
// one pg_net call instead of four. Each pass still takes the same cron lock, so
// overlapping invocations skip instead of stacking, and the pass loop stops
// early if the invocation approaches its wall-clock budget or X rate-limits us.
const PASS_INTERVAL_MS = readPositiveInt(
  "LINKR_MENTION_PASS_INTERVAL_MS",
  15_000,
);
const PASS_COUNT = Math.min(
  Math.max(readPositiveInt("LINKR_MENTION_PASSES", 4), 1),
  6,
);
const PASS_DEADLINE_MS = readPositiveInt("LINKR_MENTION_DEADLINE_MS", 52_000);

function readPositiveInt(name: string, fallback: number): number {
  const raw = Number(Deno.env.get(name));
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface SourceProvisioningResult {
  created_auth_users: number;
  created_profiles: number;
  created_wallets: number;
  created_solana_wallets: number;
  errors: Array<{ tweet_id: string; author_twitter_id: string; error: string }>;
}

interface InboxSearchResult {
  source: "combined_inbox";
  query: string;
  fetched: number;
  inserted: number;
  inserted_tweet_ids: string[];
  duplicates: number;
  skipped_bot_authored: number;
  skipped_banned: number;
  skipped_gated: number;
  skipped_unknown_parent: number;
  followups: number;
  cursor_advanced: boolean;
  cursor_reset: boolean;
  errors: string[];
  insert_errors: Array<{ tweet_id: string; error: string }>;
  provisioning: SourceProvisioningResult;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (!isCronAuthorized(req)) return unauthorizedCronResponse();

  const startedAt = Date.now();
  const admin = serviceClient();
  const passes: Array<Record<string, unknown>> = [];
  let lastResponse: Response | null = null;

  for (let pass = 0; pass < PASS_COUNT; pass++) {
    if (pass > 0) {
      if (Date.now() - startedAt + PASS_INTERVAL_MS > PASS_DEADLINE_MS) break;
      await sleep(PASS_INTERVAL_MS);
    }
    const outcome = await runMentionPass(admin, startedAt, pass);
    passes.push(outcome.summary);
    lastResponse = outcome.response;
    if (outcome.stop) break;
  }

  return jsonResponse({
    passes: passes.length,
    pass_interval_ms: PASS_INTERVAL_MS,
    results: passes,
  }, { status: lastResponse?.status ?? 200 });
});

async function runMentionPass(
  admin: any,
  invocationStartedAt: number,
  passIndex: number,
): Promise<{
  response: Response;
  summary: Record<string, unknown>;
  stop: boolean;
}> {
  const startedAt = Date.now();
  let insertedTweetIds: string[] = [];
  let rateLimited = false;
  const locked = await withCronLock(
    admin,
    { name: "cron-fetch-mentions", ttlSeconds: 25, allowWithoutRpc: true },
    async () => {
      try {
        const bearer = Deno.env.get("X_BEARER_TOKEN");
        if (!bearer) {
          const body = { skipped: "X_BEARER_TOKEN not configured" };
          await recordHealthEvent(
            admin,
            "cron-fetch-mentions",
            "degraded",
            startedAt,
            body,
          );
          return jsonResponse(body);
        }

        const source = buildInboxSearchSource(BOT_HANDLE, {
          replyToBotScanEnabled: readBoolean("LINKR_REPLY_TO_BOT_SCAN", true),
          replyToBotRequireKnownParent: readBoolean(
            "LINKR_REPLY_TO_BOT_REQUIRE_KNOWN_PARENT",
            true,
          ),
        });

        const sourceResult = await fetchAndStoreInbox(admin, bearer, source);
        insertedTweetIds = sourceResult.inserted_tweet_ids;
        rateLimited = sourceResult.errors.some((message) =>
          /\b429\b|rate.?limit/i.test(String(message))
        );

        const sourceErrored = sourceResult.errors.length > 0;
        const hasInsertErrors = sourceResult.insert_errors.length > 0;
        const hasProvisioningErrors =
          sourceResult.provisioning.errors.length > 0;
        const status = sourceErrored
          ? "down"
          : hasInsertErrors || hasProvisioningErrors
          ? "degraded"
          : "ok";

        const result = {
          active_sources: 1,
          sources: { combined_inbox: sourceResult },
        };

        await recordHealthEvent(
          admin,
          "cron-fetch-mentions",
          status,
          startedAt,
          result,
        );
        return jsonResponse(result, { status: sourceErrored ? 502 : 200 });
      } catch (error) {
        await recordHealthEvent(
          admin,
          "cron-fetch-mentions",
          "down",
          startedAt,
          {
            error: String(error),
          },
        );
        return internalErrorResponse(error, {
          function: "cron-fetch-mentions",
        });
      }
    },
  );

  if (locked.locked) {
    const body = { skipped: "locked", owner: locked.owner };
    await recordHealthEvent(
      admin,
      "cron-fetch-mentions",
      "ok",
      startedAt,
      body,
    );
    // Another invocation is already polling this window; yield the whole
    // invocation instead of burning further passes against the same lock.
    return { response: jsonResponse(body), summary: body, stop: true };
  }

  // Acceptance is the durable handoff. A wake failure never changes the fact
  // that the work item and its PGMQ pointer committed atomically.
  if (insertedTweetIds.length > 0) {
    const accepted = await admin.rpc("accept_linkr_x_page_v1", {
      p_tweet_ids: insertedTweetIds,
      p_execution_generation: 1,
    });
    if (accepted.error) {
      await recordHealthEvent(
        admin,
        "cron-fetch-mentions-chain",
        "down",
        startedAt,
        {
          durable_acceptance_failed: true,
          saved_tweet_count: insertedTweetIds.length,
          error: String(accepted.error.message ?? accepted.error).slice(0, 300),
        },
      );
      const body = {
        error: "durable_x_acceptance_failed",
        saved_tweet_count: insertedTweetIds.length,
      };
      return {
        response: jsonResponse(body, { status: 503 }),
        summary: body,
        stop: true,
      };
    }
    const wake = await admin.rpc("request_linkr_stage_wake", {
      p_stage: "x_ingress",
    });
    if (!wake.error && wake.data?.requested === true) {
      const dispatched = await invokeInternalPipelineFunction(
        "worker-x-ingress",
        {
          stage: "x_ingress",
          wake_generation: wake.data.wake_generation,
          consumer_version: wake.data.consumer_version,
        },
      );
      if (!dispatched.ok) {
        await recordHealthEvent(
          admin,
          "cron-fetch-mentions-chain",
          "degraded",
          startedAt,
          {
            wake_failed_but_queued: true,
            ...dispatched,
          },
        );
      }
    }
  }

  return {
    response: locked.result,
    summary: {
      pass: passIndex,
      elapsed_ms: Date.now() - invocationStartedAt,
      inserted: insertedTweetIds.length,
      rate_limited: rateLimited,
    },
    // Back off for the rest of the minute when X rate-limits us; the next
    // pg_cron tick retries with a fresh window.
    stop: rateLimited,
  };
}

async function fetchAndStoreInbox(
  admin: any,
  bearer: string,
  source: InboxSearchSource,
): Promise<InboxSearchResult> {
  const result = emptySourceResult(source);

  try {
    const sinceId = await loadInboxSinceId(admin, source);

    const params = buildSearchParams(source.query);
    if (sinceId) params.set("since_id", sinceId);

    let res = await fetchXSearch(params, bearer);
    if (!res.ok) {
      const text = await res.text();
      if (sinceId && isInvalidSinceIdError(text)) {
        result.cursor_reset = true;
        params.delete("since_id");
        const { error: resetError } = await admin.from("app_state").upsert(
          {
            key: source.cursorKey,
            value: {
              id: null,
              reset_at: new Date().toISOString(),
              reset_reason: "x_rejected_since_id",
              rejected_since_id: sinceId,
              source: "combined_inbox",
            },
          },
          { onConflict: "key" },
        );
        if (resetError) {
          result.errors.push(`cursor_reset_write_error: ${resetError.message}`);
          return result;
        }
        res = await fetchXSearch(params, bearer);
        if (!res.ok) {
          result.errors.push(
            `x_api_error_after_cursor_reset: ${await res.text()}`,
          );
          return result;
        }
      } else {
        result.errors.push(`x_api_error: ${text}`);
        return result;
      }
    }

    const pages = await fetchAllXSearchPages({
      firstResponse: res,
      baseUrl: X_API,
      params,
      bearer,
    });
    const seenThisSource = new Set<string>();
    const activeBanCache = new Map<string, boolean>();
    const gatingCache = new Map<string, boolean>();
    let newestId = sinceId;

    // X pagination is newest-first. Persist oldest pages first so the existing
    // created_at-ordered consumer observes deterministic arrival order.
    for (const body of oldestFirstXPages(pages)) {
      const tweets: any[] = body.data ?? [];
      const users: any[] = body.includes?.users ?? [];
      const media: any[] = body.includes?.media ?? [];
      const referencedTweets: any[] = body.includes?.tweets ?? [];
      const userById = new Map(users.map((u) => [u.id, u]));
      const mediaByKey = new Map(media.map((m) => [m.media_key, m]));
      const referencedTweetById = new Map(
        referencedTweets.map((t) => [t.id, t]),
      );
      const existingTweetIds = await loadExistingTweetIds(
        admin,
        tweets.map((tweet) => String(tweet.id)).filter(Boolean),
      );
      result.fetched += tweets.length;

      for (const tw of tweets) {
        const tweetId = String(tw.id ?? "");
        if (!tweetId) continue;
        if (!newestId || BigInt(tweetId) > BigInt(newestId)) newestId = tweetId;

        const user = userById.get(tw.author_id);
        if (user?.username?.toLowerCase() === BOT_HANDLE) {
          result.skipped_bot_authored++;
          continue;
        }

        if (isDuplicateTweetId(tweetId, existingTweetIds, seenThisSource)) {
          result.duplicates++;
          continue;
        }
        seenThisSource.add(tweetId);

        const authorId = String(tw.author_id ?? "");
        let isBanned = activeBanCache.get(authorId);
        if (isBanned == null) {
          isBanned = Boolean(await getActiveXBan(admin, authorId));
          activeBanCache.set(authorId, isBanned);
        }
        if (isBanned) {
          result.skipped_banned++;
          continue;
        }
        let eligible = gatingCache.get(authorId);
        if (eligible == null) {
          const gating = await evaluateXUserGating({
            admin,
            xUserId: authorId,
            username: user?.username ?? null,
            publicMetrics: user?.public_metrics ?? {},
            source: "cron-fetch-mentions",
          });
          eligible = gating.eligible;
          gatingCache.set(authorId, eligible);
        }
        if (!eligible) {
          result.skipped_gated++;
          continue;
        }

        const ref: any[] = tw.referenced_tweets ?? [];
        const followUp = await checkIsFollowUp(admin, ref);
        if (followUp.isFollowUp) result.followups++;
        const ingest = decideInboxIngest(source, tw.text ?? "", followUp);
        if (!ingest.shouldIngest) {
          result.skipped_unknown_parent++;
          continue;
        }

        const mediaKeys: string[] = tw.attachments?.media_keys ?? [];
        const firstMedia = mediaKeys.map((k) => mediaByKey.get(k)).find(
          Boolean,
        );
        const hasMedia = !!firstMedia;
        const mediaUrl: string | null = firstMedia?.url ??
          firstMedia?.preview_image_url ?? null;

        const parent = ref.find((r) => r.type === "replied_to");
        const root = ref.find((r) => r.type === "quoted") ?? parent;
        const parentTweet = parent?.id
          ? referencedTweetById.get(parent.id)
          : null;
        const rootTweet = root?.id ? referencedTweetById.get(root.id) : null;
        const extracted = extractFromText(tw.text ?? "");
        const tweetUrl = `https://x.com/${
          user?.username ?? "i/web"
        }/status/${tweetId}`;
        const seededFlattenedContext = buildSeededFlattenedContext({
          parentText: parentTweet?.text ?? null,
          rootText: rootTweet && rootTweet.id !== parentTweet?.id
            ? rootTweet.text
            : null,
          userText: tw.text ?? "",
        });

        const { error } = await admin.from("tweets_inbox").upsert(
          {
            tweet_id: tweetId,
            conversation_id: tw.conversation_id ?? null,
            author_twitter_id: tw.author_id,
            author_username: user?.username ?? null,
            text: tw.text ?? "",
            tweet_url: tweetUrl,
            has_media: hasMedia,
            media_url: mediaUrl,
            referenced_tweet_id: parent?.id ?? null,
            parent_tweet_id: parent?.id ?? null,
            root_tweet_id: root?.id ?? null,
            is_follow_up: followUp.isFollowUp,
            parent_inbox_tweet_id: followUp.parentInboxTweetId,
            parent_reply_tweet_id: followUp.parentReplyTweetId,
            ingest_source: ingest.source,
            ingest_reason: ingest.reason,
            status: "pending",
            queue_generation: 1,
          },
          { onConflict: "tweet_id", ignoreDuplicates: true },
        );
        if (error) {
          result.insert_errors.push({
            tweet_id: tweetId,
            error: error.message,
          });
          continue;
        }

        result.inserted++;
        result.inserted_tweet_ids.push(tweetId);
        await provisionTweetAuthor(admin, result.provisioning, tw, user);
        await seedThreadContext(admin, {
          tweetId,
          tw,
          root,
          parent,
          extracted,
          mediaUrl,
          seededFlattenedContext,
        });
      }
    }

    await acceptShadowXPage(admin, result.inserted_tweet_ids).catch((error) => {
      result.errors.push(`shadow_x_accept_error: ${String(error)}`);
    });

    if (newestId && newestId !== sinceId && result.insert_errors.length === 0) {
      const { error: cursorError } = await admin.from("app_state").upsert(
        {
          key: source.cursorKey,
          value: {
            id: newestId,
            fetched_at: new Date().toISOString(),
            source: "combined_inbox",
          },
        },
        { onConflict: "key" },
      );
      if (cursorError) {
        result.errors.push(
          `cursor_advance_write_error: ${cursorError.message}`,
        );
        return result;
      }
      result.cursor_advanced = true;
    }
  } catch (error) {
    result.errors.push(String(error));
  }

  return result;
}

async function fetchXSearch(
  params: URLSearchParams,
  bearer: string,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    return await fetch(`${X_API}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${bearer}` },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function loadInboxSinceId(
  admin: any,
  source: InboxSearchSource,
): Promise<string | undefined> {
  const { data: currentRow, error: currentError } = await admin
    .from("app_state")
    .select("value")
    .eq("key", source.cursorKey)
    .maybeSingle();
  if (currentError) throw currentError;

  const current = normalizeSinceId((currentRow?.value as any)?.id);
  if (current) return current;

  // First-deploy bootstrap only: start at the older legacy cursor so combining
  // searches cannot create a gap. Duplicate rows remain protected by tweet_id.
  const { data: legacyRows, error: legacyError } = await admin
    .from("app_state")
    .select("key,value")
    .in("key", [...source.legacyCursorKeys]);
  if (legacyError) throw legacyError;
  const bootstrapped = oldestSinceId(
    (legacyRows ?? []).map((row: any) => row?.value?.id),
  );
  if (!bootstrapped) return undefined;

  const { error: bootstrapError } = await admin.from("app_state").upsert(
    {
      key: source.cursorKey,
      value: {
        id: bootstrapped,
        bootstrapped_at: new Date().toISOString(),
        bootstrapped_from: source.legacyCursorKeys,
      },
    },
    { onConflict: "key" },
  );
  if (bootstrapError) throw bootstrapError;
  return bootstrapped;
}

function buildSearchParams(query: string): URLSearchParams {
  return new URLSearchParams({
    query,
    // Preserve the former aggregate capacity of two 50-result searches while
    // issuing only one X API request.
    max_results: "100",
    "tweet.fields":
      "id,text,author_id,created_at,conversation_id,attachments,referenced_tweets",
    "user.fields": "id,username,name,profile_image_url,public_metrics",
    "media.fields": "media_key,type,url,preview_image_url",
    expansions: "author_id,attachments.media_keys,referenced_tweets.id",
  });
}

function emptySourceResult(source: InboxSearchSource): InboxSearchResult {
  return {
    source: "combined_inbox",
    query: source.query,
    fetched: 0,
    inserted: 0,
    inserted_tweet_ids: [],
    duplicates: 0,
    skipped_bot_authored: 0,
    skipped_banned: 0,
    skipped_gated: 0,
    skipped_unknown_parent: 0,
    followups: 0,
    cursor_advanced: false,
    cursor_reset: false,
    errors: [],
    insert_errors: [],
    provisioning: {
      created_auth_users: 0,
      created_profiles: 0,
      created_wallets: 0,
      created_solana_wallets: 0,
      errors: [],
    },
  };
}

async function loadExistingTweetIds(
  admin: any,
  tweetIds: string[],
): Promise<Set<string>> {
  if (tweetIds.length === 0) return new Set();
  const { data, error } = await admin
    .from("tweets_inbox")
    .select("tweet_id")
    .in("tweet_id", [...new Set(tweetIds)]);
  if (error) throw error;
  return new Set((data ?? []).map((row: any) => String(row.tweet_id)));
}

async function provisionTweetAuthor(
  admin: any,
  provisioning: SourceProvisioningResult,
  tw: any,
  user: any,
) {
  try {
    const provisioned = await ensureProvisionedXUser(admin, {
      twitterId: tw.author_id,
      username: user?.username ?? null,
      name: user?.name ?? null,
      profileImageUrl: user?.profile_image_url ?? null,
      source: "tweet_mention",
      sourceTweetId: tw.id,
    });
    if (provisioned.createdAuthUser) provisioning.created_auth_users++;
    if (provisioned.createdProfile) provisioning.created_profiles++;
    if (provisioned.createdWallet) provisioning.created_wallets++;
    if (provisioned.createdSolanaWallet) provisioning.created_solana_wallets++;
  } catch (error) {
    provisioning.errors.push({
      tweet_id: String(tw.id ?? ""),
      author_twitter_id: String(tw.author_id ?? ""),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function seedThreadContext(
  admin: any,
  args: {
    tweetId: string;
    tw: any;
    root: any;
    parent: any;
    extracted: { mints: string[]; symbols: string[]; urls: string[] };
    mediaUrl: string | null;
    seededFlattenedContext: string;
  },
) {
  await admin.from("tweet_thread_contexts").insert({
    tweet_id: args.tweetId,
    root_tweet_id: args.root?.id ?? null,
    parent_tweet_id: args.parent?.id ?? null,
    context_json: {
      bot_mention_tweet: args.tw,
      parent_chain: [],
      root_tweet: null,
    },
    flattened_context: args.seededFlattenedContext,
    detected_mints: args.extracted.mints,
    detected_symbols: args.extracted.symbols,
    detected_urls: args.extracted.urls,
    detected_media_urls: args.mediaUrl ? [args.mediaUrl] : [],
  });
}

function readBoolean(name: string, fallback: boolean) {
  const raw = Deno.env.get(name);
  if (raw == null || raw.trim() === "") return fallback;
  if (/^(1|true|yes|on)$/i.test(raw)) return true;
  if (/^(0|false|no|off)$/i.test(raw)) return false;
  return fallback;
}
