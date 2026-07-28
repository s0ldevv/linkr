// deno-lint-ignore-file no-explicit-any
import {
  classifyXNftIntentWithAi,
  isBareCancellation,
  isBareConfirmation,
  isExplicitNftCancellation,
  isExplicitNftConfirmation,
  isNftActionType,
  mergeNftFollowupIntoFields,
  mergeNftIntentIntoFields,
  type NftCollectionChoice,
  nftConfirmationPhrase,
  nftFieldsToCommand,
  nftSummary,
  normalizeNftFields,
  requiredNftFields,
  type XNftDraftFields,
} from "./x_nft_intent.ts";

export type XNftPrepareOutcome = {
  replyKind: string;
  replyText: string;
  state: string;
  resultRef: string;
};

type XTweet = {
  tweet_id: string;
  conversation_id?: string | null;
  text?: string | null;
  media_url?: string | null;
  parent_tweet_id?: string | null;
  referenced_tweet_id?: string | null;
  root_tweet_id?: string | null;
};

export async function prepareXNftXFlow(args: {
  admin: any;
  userId: string;
  workItem: any;
  tweet: XTweet;
  pendingActions: any[];
}): Promise<XNftPrepareOutcome | null> {
  const text = String(args.tweet.text ?? "");
  const pendingNfts = args.pendingActions.filter((pending) =>
    isNftActionType(pending?.action_type)
  );
  const onlyPendingIsNft = args.pendingActions.length === 1 &&
    pendingNfts.length === 1;
  const nftPending = pendingNfts[0] ?? null;

  if (
    isExplicitNftConfirmation(text) ||
    (isBareConfirmation(text) && onlyPendingIsNft)
  ) {
    if (!nftPending) {
      return {
        replyKind: "nft_confirmation_missing",
        replyText: "I couldn't find a pending NFT action in this thread.",
        state: "rejected",
        resultRef: "nft-confirmation-missing",
      };
    }
    const confirmed = await args.admin.rpc("confirm_linkr_nft_action_v1", {
      p_pending_action_id: nftPending.id,
      p_confirmation_work_item_id: args.workItem.id,
    });
    if (confirmed.error) throw confirmed.error;
    return {
      replyKind: confirmed.data?.expired
        ? "nft_confirmation_expired"
        : "nft_confirmation_ack",
      replyText: confirmed.data?.expired
        ? "That NFT approval expired. Nothing was signed or submitted. Start a new NFT request when you're ready."
        : "NFT approved. The Solana worker is preparing it now.",
      state: "succeeded",
      resultRef: `nft-confirmation:${nftPending.id}`,
    };
  }

  if (
    isExplicitNftCancellation(text) ||
    (isBareCancellation(text) && onlyPendingIsNft)
  ) {
    if (!nftPending) {
      return {
        replyKind: "nft_cancellation_missing",
        replyText: "I couldn't find a pending NFT action in this thread.",
        state: "rejected",
        resultRef: "nft-cancellation-missing",
      };
    }
    const cancelled = await args.admin.rpc("cancel_linkr_nft_action_v1", {
      p_pending_action_id: nftPending.id,
      p_cancellation_work_item_id: args.workItem.id,
    });
    if (cancelled.error) throw cancelled.error;
    return {
      replyKind: "nft_cancelled",
      replyText:
        "NFT action cancelled. No transaction was signed or submitted.",
      state: "succeeded",
      resultRef: `nft-cancelled:${nftPending.id}`,
    };
  }

  const existingDraft = await loadOpenNftDraft(
    args.admin,
    args.userId,
    args.tweet,
  );
  if (existingDraft && isLikelyNftDraftFollowup(text, existingDraft)) {
    const fields = mergeNftFollowupIntoFields(
      normalizeNftFields(existingDraft.filled_fields ?? {}),
      text,
      Array.isArray(existingDraft.required_fields)
        ? existingDraft.required_fields
        : [],
      args.tweet.tweet_id,
    );
    return await evaluateNftFields({
      ...args,
      existingDraft,
      fields,
    });
  }

  const intent = await classifyXNftIntentWithAi(text);
  if (intent.intent === "nft_guidance") return null;
  if (!intent.executionIntent || intent.intent === "none") return null;

  const fields = mergeNftIntentIntoFields({}, intent, args.tweet.tweet_id);
  return await evaluateNftFields({
    ...args,
    existingDraft: null,
    fields,
  });
}

async function evaluateNftFields(args: {
  admin: any;
  userId: string;
  workItem: any;
  tweet: XTweet;
  existingDraft: any | null;
  fields: XNftDraftFields;
}): Promise<XNftPrepareOutcome> {
  let fields = normalizeNftFields({
    ...args.fields,
    tweet_id: args.tweet.tweet_id,
  });
  if (!fields.kind) fields = { ...fields, kind: "mint_nft" };

  if (fields.chain === "robinhood") {
    const draft = await upsertNftDraft(args, fields, []);
    await closeDraft(args.admin, draft.id, "completed", {
      reason: "robinhood_nft_not_wired",
    });
    return {
      replyKind: "nft_robinhood_unavailable",
      replyText:
        "Robinhood NFT launches are not wired yet. For now, NFT collections and mints are available on Solana.",
      state: rootAwareState(args.workItem.id, draft, "rejected"),
      resultRef: `draft:${draft.id}`,
    };
  }

  let missing = requiredNftFields(fields);
  if (missing.includes("chain")) {
    const draft = await upsertNftDraft(args, fields, missing);
    return {
      replyKind: "nft_chain_clarification",
      replyText: fields.kind === "create_collection"
        ? "NFT collections are wired on Solana right now. Reply `solana` to continue creating the collection."
        : "Do you want this NFT launched on Robinhood or Solana? Robinhood NFT launches are not wired yet; Solana mints into a collection.",
      state: rootAwareState(args.workItem.id, draft, "waiting_user_input"),
      resultRef: `draft:${draft.id}`,
    };
  }

  if (fields.chain !== "solana") {
    const draft = await upsertNftDraft(args, fields, ["chain"]);
    return {
      replyKind: "nft_chain_clarification",
      replyText:
        "Reply `solana` to continue. Robinhood NFT launches are not wired yet.",
      state: rootAwareState(args.workItem.id, draft, "waiting_user_input"),
      resultRef: `draft:${draft.id}`,
    };
  }

  if (fields.kind === "create_collection") {
    missing = requiredNftFields(fields);
    if (missing.includes("name")) {
      const draft = await upsertNftDraft(args, fields, missing);
      return {
        replyKind: "nft_collection_name_required",
        replyText: "What should the Solana NFT collection be called?",
        state: rootAwareState(args.workItem.id, draft, "waiting_user_input"),
        resultRef: `draft:${draft.id}`,
      };
    }
    const image = await hasResolvableNftImage(args.admin, args.tweet);
    if (!image.ok) {
      const draft = await upsertNftDraft(args, fields, ["image"]);
      return {
        replyKind: "nft_collection_image_required",
        replyText:
          "Attach the collection artwork, or tag me under a post with the image, then I can prepare the Solana collection.",
        state: rootAwareState(args.workItem.id, draft, "waiting_user_input"),
        resultRef: `draft:${draft.id}`,
      };
    }
    fields = normalizeNftFields({
      ...fields,
      media_tweet_id: image.tweetId ?? args.tweet.tweet_id,
    });
    return await createReadyNftPendingAction(args, fields);
  }

  fields = await resolveNftCollection(args, fields);
  missing = requiredNftFields(fields);
  if (missing.includes("collection")) {
    const choices = await loadNftCollectionChoices(args.admin, args.userId);
    const draft = await upsertNftDraft(args, fields, ["collection"]);
    if (choices.length === 0) {
      return {
        replyKind: "nft_collection_required",
        replyText:
          "On Solana, a single NFT has to be minted into a confirmed collection first. Create a collection, then I can mint this NFT into it.",
        state: rootAwareState(args.workItem.id, draft, "waiting_user_input"),
        resultRef: `draft:${draft.id}`,
      };
    }
    return {
      replyKind: "nft_collection_choice_required",
      replyText: collectionChoiceReply(choices),
      state: rootAwareState(args.workItem.id, draft, "waiting_user_input"),
      resultRef: `draft:${draft.id}`,
    };
  }

  const image = await hasResolvableNftImage(args.admin, args.tweet);
  if (!image.ok) {
    const draft = await upsertNftDraft(args, fields, ["image"]);
    return {
      replyKind: "nft_image_required",
      replyText:
        "Attach the NFT image, or tag me under a post with the image, then I can prepare the Solana mint.",
      state: rootAwareState(args.workItem.id, draft, "waiting_user_input"),
      resultRef: `draft:${draft.id}`,
    };
  }
  fields = normalizeNftFields({
    ...fields,
    media_tweet_id: image.tweetId ?? args.tweet.tweet_id,
  });
  return await createReadyNftPendingAction(args, fields);
}

async function createReadyNftPendingAction(args: {
  admin: any;
  userId: string;
  workItem: any;
  tweet: XTweet;
  existingDraft: any | null;
}, fields: XNftDraftFields): Promise<XNftPrepareOutcome> {
  const wallet = await resolvePrimarySolanaWallet(args.admin, args.userId);
  if (!wallet) {
    const draft = await upsertNftDraft(args, fields, []);
    return {
      replyKind: "nft_wallet_missing",
      replyText:
        "You need a Solana wallet linked before I can prepare an NFT mint. Set one up in the dashboard, then try again.",
      state: rootAwareState(args.workItem.id, draft, "rejected"),
      resultRef: `draft:${draft.id}`,
    };
  }

  const draft = await upsertNftDraft(args, fields, []);
  const pending = await createNftPendingAction(
    args.admin,
    args.userId,
    args.workItem.id,
    draft,
    fields,
    wallet.id,
  );
  const actionType = String(pending.action_type ?? "");
  const phrase = nftConfirmationPhrase(actionType);
  const collectionName = fields.collection_name ?? fields.collection_query;
  const replyText = actionType === "nft_create_collection"
    ? `Ready to create the ${fields.name} Solana NFT collection. Reply \`${phrase}\` to proceed.`
    : `I found your ${collectionName} collection. Reply \`${phrase}\` and I will mint this NFT into it.`;
  return {
    replyKind: actionType === "nft_create_collection"
      ? "nft_collection_confirmation_required"
      : "nft_confirmation_required",
    replyText,
    state: rootAwareState(args.workItem.id, draft, "waiting_user_confirmation"),
    resultRef: `pending_action:${pending.id}`,
  };
}

async function resolveNftCollection(args: {
  admin: any;
  userId: string;
}, fields: XNftDraftFields): Promise<XNftDraftFields> {
  const normalized = normalizeNftFields(fields);
  if (normalized.collection_id && normalized.collection_name) return normalized;

  const query = normalized.collection_id ??
    normalized.collection_query ??
    normalized.collection_name ??
    null;
  const choices = await loadNftCollectionChoices(
    args.admin,
    args.userId,
    query,
  );
  if (choices.length === 1) {
    return normalizeNftFields({
      ...normalized,
      collection_id: choices[0].id,
      collection_name: choices[0].name,
      collection_query: normalized.collection_query ?? choices[0].name,
    });
  }
  if (!query && choices.length === 1) {
    return normalizeNftFields({
      ...normalized,
      collection_id: choices[0].id,
      collection_name: choices[0].name,
      collection_query: choices[0].name,
    });
  }
  return normalized;
}

async function loadNftCollectionChoices(
  admin: any,
  userId: string,
  query?: string | null,
): Promise<NftCollectionChoice[]> {
  const result = await admin.rpc("list_linkr_nft_collections_v1", {
    p_user_id: userId,
    p_query: query ?? null,
    p_limit: 5,
  });
  if (result.error) throw result.error;
  return Array.isArray(result.data)
    ? result.data.map((row: any) => ({
      id: String(row.id ?? ""),
      name: String(row.name ?? ""),
      symbol: row.symbol ? String(row.symbol) : null,
      mint_address: row.mint_address ? String(row.mint_address) : null,
      created_at: row.created_at ? String(row.created_at) : null,
      match_kind: row.match_kind ? String(row.match_kind) : null,
    })).filter((row: NftCollectionChoice) => row.id && row.name)
    : [];
}

async function upsertNftDraft(
  args: {
    admin: any;
    userId: string;
    workItem: any;
    tweet: XTweet;
    existingDraft: any | null;
  },
  fields: XNftDraftFields,
  requiredFields: string[],
): Promise<any> {
  const normalized = normalizeNftFields(fields);
  const existing = args.existingDraft ?? await loadOpenNftDraft(
    args.admin,
    args.userId,
    args.tweet,
  );
  const status = requiredFields.length > 0 ? "awaiting_clarification" : "open";
  const rootWorkItemId = existing?.work_item_id ?? args.workItem.id;
  const draftKey = existing?.draft_key ?? nftDraftKey(args.tweet, args.userId);
  const sourceRefs = appendTweetSourceRef(existing?.source_refs, args.tweet);
  const updateShape = {
    source_tweet_id: args.tweet.tweet_id,
    action_type: normalized.kind === "create_collection"
      ? "nft_create_collection"
      : "nft_mint",
    status,
    required_fields: requiredFields,
    filled_fields: normalized,
    field_provenance: {
      ...(existing?.field_provenance ?? {}),
      last_user_text: "user_text",
    },
    generation_context: {
      ...(existing?.generation_context ?? {}),
      nft_pending_confirmation_flow: true,
      last_input_tweet_id: args.tweet.tweet_id,
    },
    surface_conversation_id: args.tweet.conversation_id ?? null,
    x_thread_id: args.tweet.conversation_id ?? null,
    source_refs: sourceRefs,
    last_input_work_item_id: args.workItem.id,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    closed_at: null,
    last_user_input_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  let draft;
  if (existing?.id) {
    const updated = await args.admin.from("linkr_action_drafts").update({
      ...updateShape,
      version: Number(existing.version ?? 1) + 1,
    }).eq("id", existing.id).select("*").single();
    if (updated.error) throw updated.error;
    draft = updated.data;
  } else {
    const generation = await nextDraftGeneration(
      args.admin,
      args.userId,
      draftKey,
    );
    const inserted = await args.admin.from("linkr_action_drafts").insert({
      user_id: args.userId,
      conversation_id: args.tweet.conversation_id ?? null,
      source_tweet_id: args.tweet.tweet_id,
      draft_key: draftKey,
      action_type: normalized.kind === "create_collection"
        ? "nft_create_collection"
        : "nft_mint",
      status,
      required_fields: requiredFields,
      filled_fields: normalized,
      entity_refs: [],
      privacy_label: "user_private",
      idempotency_key: `draft:nft:${args.userId}:${draftKey}:g${generation}`,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      surface: "x",
      surface_conversation_id: args.tweet.conversation_id ?? null,
      x_thread_id: args.tweet.conversation_id ?? null,
      source_refs: sourceRefs,
      source_surface: "x",
      work_item_id: rootWorkItemId,
      last_input_work_item_id: args.workItem.id,
      version: 1,
      session_generation: generation,
      field_provenance: { last_user_text: "user_text" },
      generation_context: {
        nft_pending_confirmation_flow: true,
        explicit_nft_intent: true,
        last_input_tweet_id: args.tweet.tweet_id,
      },
      last_user_input_at: new Date().toISOString(),
    }).select("*").single();
    if (inserted.error) throw inserted.error;
    draft = inserted.data;
  }

  await markDraftWorkItems(
    args.admin,
    args.workItem.id,
    rootWorkItemId,
    draft.id,
  );
  return draft;
}

async function createNftPendingAction(
  admin: any,
  userId: string,
  inputWorkItemId: string,
  draft: any,
  fields: XNftDraftFields,
  walletId: string,
): Promise<any> {
  const normalized = normalizeNftFields(fields);
  const command = nftFieldsToCommand(normalized);
  if (!command) throw new Error("nft_pending_command_invalid");
  const actionType = normalized.kind === "create_collection"
    ? "nft_create_collection"
    : "nft_mint";
  const idempotencyKey = `x:nft:${draft.id}:g${
    Number(draft.session_generation ?? 1)
  }:v1`;

  const existing = await admin.from("linkr_pending_actions").select("*")
    .eq("user_id", userId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) {
    await markNftPendingReady(admin, inputWorkItemId, draft, existing.data.id);
    return existing.data;
  }

  const payload = {
    ...normalized,
    kind: command.kind,
    chain: "solana",
    tweet_id: normalized.tweet_id ?? draft.source_tweet_id,
    wallet_id: walletId,
    command,
    media: {
      source: "tweet_media",
      tweet_id: normalized.media_tweet_id ?? normalized.tweet_id ??
        draft.source_tweet_id,
    },
  };
  const insert = await admin.from("linkr_pending_actions").insert({
    user_id: userId,
    surface: "x",
    surface_conversation_id: draft.surface_conversation_id,
    x_thread_id: draft.x_thread_id,
    draft_id: draft.id,
    action_type: actionType,
    status: "pending",
    confirmation_phrase: nftConfirmationPhrase(actionType),
    summary: nftSummary(normalized).slice(0, 500),
    action_payload: payload,
    risk_summary: [
      actionType === "nft_create_collection"
        ? "Creating an NFT collection submits an irreversible Solana transaction."
        : "Minting an NFT submits an irreversible Solana transaction.",
    ],
    deterministic_validation: {
      required_fields_complete: true,
      chain_user_selected: true,
      wallet_verified: true,
      root_work_item_id: draft.work_item_id,
      preparation_work_item_id: inputWorkItemId,
    },
    source_refs: draft.source_refs ?? [],
    idempotency_key: idempotencyKey,
    expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    source_surface: "x",
    work_item_id: draft.work_item_id,
    draft_version: draft.version,
  }).select("*").single();
  if (insert.error) {
    if (String(insert.error.code ?? "") === "23505") {
      const raced = await admin.from("linkr_pending_actions").select("*")
        .eq("user_id", userId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (raced.error) throw raced.error;
      if (raced.data) {
        await markNftPendingReady(admin, inputWorkItemId, draft, raced.data.id);
        return raced.data;
      }
    }
    throw insert.error;
  }

  await markNftPendingReady(admin, inputWorkItemId, draft, insert.data.id);

  return insert.data;
}

async function markNftPendingReady(
  admin: any,
  inputWorkItemId: string,
  draft: any,
  pendingActionId: string,
) {
  const draftUpdate = await admin.from("linkr_action_drafts").update({
    status: "converted_to_pending",
    closed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", draft.id);
  if (draftUpdate.error) throw draftUpdate.error;

  if (draft.work_item_id !== inputWorkItemId) {
    const rootUpdate = await admin.from("linkr_work_items").update({
      state: "waiting_user_confirmation",
      result_ref: `pending_action:${pendingActionId}`,
      next_attempt_at: null,
      last_error_code: null,
      last_progress_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", draft.work_item_id);
    if (rootUpdate.error) throw rootUpdate.error;
  }
}

async function loadOpenNftDraft(
  admin: any,
  userId: string,
  tweet: XTweet,
): Promise<any | null> {
  const result = await admin.from("linkr_action_drafts").select("*")
    .eq("user_id", userId)
    .eq("surface", "x")
    .eq("surface_conversation_id", tweet.conversation_id)
    .in("action_type", ["nft_create_collection", "nft_mint"])
    .in("status", ["open", "awaiting_clarification", "ready"])
    .gt("expires_at", new Date().toISOString())
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data ?? null;
}

async function hasResolvableNftImage(
  admin: any,
  tweet: XTweet,
): Promise<{ ok: boolean; tweetId: string | null }> {
  if (tweet.media_url && /^https?:\/\//i.test(tweet.media_url)) {
    return { ok: true, tweetId: tweet.tweet_id };
  }
  const candidates = [
    tweet.parent_tweet_id,
    tweet.referenced_tweet_id,
    tweet.root_tweet_id,
    tweet.conversation_id,
  ].map((value) => String(value ?? "").trim()).filter((value, index, all) =>
    value && value !== tweet.tweet_id && all.indexOf(value) === index
  ).slice(0, 4);
  for (const candidate of candidates) {
    const result = await admin.from("tweets_inbox").select("tweet_id,media_url")
      .eq("tweet_id", candidate)
      .maybeSingle();
    if (result.error) throw result.error;
    if (result.data?.media_url && /^https?:\/\//i.test(result.data.media_url)) {
      return { ok: true, tweetId: String(result.data.tweet_id ?? candidate) };
    }
  }
  return { ok: false, tweetId: null };
}

async function resolvePrimarySolanaWallet(admin: any, userId: string) {
  const result = await admin.from("wallets").select("id,address,public_key")
    .eq("user_id", userId)
    .eq("wallet_type", "solana")
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data ?? null;
}

async function closeDraft(
  admin: any,
  draftId: string,
  status: "completed" | "cancelled" | "failed",
  context: Record<string, unknown>,
) {
  const result = await admin.from("linkr_action_drafts").update({
    status,
    generation_context: context,
    closed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", draftId);
  if (result.error) throw result.error;
}

async function markDraftWorkItems(
  admin: any,
  inputWorkItemId: string,
  rootWorkItemId: string,
  draftId: string,
) {
  const result = await admin.from("linkr_work_items").update({
    result_ref: `draft:${draftId}`,
    last_progress_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).in("id", [inputWorkItemId, rootWorkItemId]);
  if (result.error) throw result.error;
}

async function nextDraftGeneration(
  admin: any,
  userId: string,
  draftKey: string,
): Promise<number> {
  const result = await admin.from("linkr_action_drafts")
    .select("session_generation")
    .eq("user_id", userId)
    .eq("draft_key", draftKey)
    .order("session_generation", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) throw result.error;
  return Number(result.data?.session_generation ?? 0) + 1;
}

function isLikelyNftDraftFollowup(text: string, draft: any): boolean {
  const value = String(text ?? "").trim();
  if (!value) return false;
  if (isExplicitNftConfirmation(value) || isExplicitNftCancellation(value)) {
    return true;
  }
  const fields = normalizeNftFields(draft.filled_fields ?? {});
  const required = Array.isArray(draft.required_fields)
    ? draft.required_fields
    : [];
  const merged = mergeNftFollowupIntoFields(fields, value, required);
  return JSON.stringify(merged) !== JSON.stringify(fields) ||
    /\b(?:nft|collection|solana|robinhood|mint|launch|create|drop)\b/i.test(
      value,
    );
}

function nftDraftKey(tweet: XTweet, userId: string): string {
  return `nft:${
    tweet.conversation_id ?? tweet.root_tweet_id ?? tweet.tweet_id ?? userId
  }`;
}

function appendTweetSourceRef(existing: unknown, tweet: XTweet): unknown[] {
  const refs = Array.isArray(existing) ? [...existing] : [];
  if (
    tweet.tweet_id &&
    !refs.some((ref) =>
      ref && typeof ref === "object" &&
      (ref as Record<string, unknown>).tweet_id === tweet.tweet_id
    )
  ) {
    refs.push({ tweet_id: tweet.tweet_id });
  }
  return refs.slice(-10);
}

function rootAwareState(
  inputWorkItemId: string,
  draft: any,
  rootState: string,
): string {
  return draft?.work_item_id === inputWorkItemId ? rootState : "succeeded";
}

function collectionChoiceReply(choices: NftCollectionChoice[]): string {
  const names = choices.slice(0, 5).map((choice) => choice.name).join(", ");
  return `Which Solana collection should I mint this into? Reply with one of: ${names}.`;
}
