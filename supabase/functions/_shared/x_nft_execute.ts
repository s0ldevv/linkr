// deno-lint-ignore-file no-explicit-any
// Synchronous NFT command executor invoked from worker-command-prepare.
// Matches the shape of executeXTradeCommand.

import type { XNftCommand } from "./x_nft_command.ts";
import { generateCollectionDescriptionWithAi } from "./x_nft_command.ts";
import {
  captureBoundedExternalImage,
  storeCapturedImage,
} from "./bounded_media.ts";

const NFT_MIN_REQUIRED_SOL = 0.02;

export interface XNftExecutionInput {
  admin: any;
  userId: string;
  tweetId: string;
  tweet: {
    tweet_id: string;
    conversation_id?: string | null;
    text?: string | null;
    media_url?: string | null;
    parent_tweet_id?: string | null;
    referenced_tweet_id?: string | null;
  };
  command: XNftCommand;
}

export interface XNftExecutionResult {
  ok: boolean;
  replyKind: string;
  replyText: string;
}

function trim(text: string): string {
  const s = String(text ?? "").trim();
  return s.length > 260 ? s.slice(0, 257) + "..." : s;
}

// Resolve image URL following the user's rule:
//   - user_media if the current tweet has an attached image
//   - parent_media (tweet the user replied to) otherwise
async function resolveImageUrl(
  admin: any,
  tweet: XNftExecutionInput["tweet"],
): Promise<{ url: string | null; source: "user_media" | "parent_media" | "unknown" }> {
  if (tweet.media_url && /^https?:\/\//i.test(tweet.media_url)) {
    return { url: tweet.media_url, source: "user_media" };
  }
  // Try direct parent (reply target)
  const candidates: string[] = [];
  if (tweet.parent_tweet_id) candidates.push(tweet.parent_tweet_id);
  if (tweet.referenced_tweet_id && !candidates.includes(tweet.referenced_tweet_id)) {
    candidates.push(tweet.referenced_tweet_id);
  }
  if (
    tweet.conversation_id &&
    tweet.conversation_id !== tweet.tweet_id &&
    !candidates.includes(tweet.conversation_id)
  ) {
    candidates.push(tweet.conversation_id);
  }
  for (const id of candidates) {
    const { data } = await admin
      .from("tweets_inbox")
      .select("media_url")
      .eq("tweet_id", id)
      .maybeSingle();
    if (data?.media_url && /^https?:\/\//i.test(data.media_url)) {
      return { url: data.media_url, source: "parent_media" };
    }
  }
  return { url: null, source: "unknown" };
}

async function resolveWallet(admin: any, userId: string) {
  const { data, error } = await admin
    .from("wallets")
    .select("id,address,public_key")
    .eq("user_id", userId)
    .eq("wallet_type", "solana")
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function findCollection(admin: any, userId: string, query: string) {
  const raw = String(query ?? "").trim();
  if (!raw) return null;
  // Postgrest .or() with commas in values breaks the parser; escape and wrap.
  const safe = raw.replace(/[,()"']/g, " ").trim();
  if (!safe) return null;
  const like = `%${safe}%`;
  // Try exact-ish first (mint address or exact name/symbol match).
  const exact = await admin
    .from("nft_collections")
    .select("id,name,symbol,mint_address,status")
    .eq("user_id", userId)
    .eq("status", "confirmed")
    .or(
      `name.ilike.${safe},symbol.ilike.${safe.toUpperCase()},mint_address.eq.${raw}`,
    )
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (exact.data) return exact.data;
  // Fuzzy contains match on name/symbol.
  const fuzzy = await admin
    .from("nft_collections")
    .select("id,name,symbol,mint_address,status")
    .eq("user_id", userId)
    .eq("status", "confirmed")
    .or(`name.ilike.${like},symbol.ilike.${like}`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return fuzzy.data ?? null;
}

export async function executeXNftCommand(
  input: XNftExecutionInput,
): Promise<XNftExecutionResult> {
  const wallet = await resolveWallet(input.admin, input.userId);
  if (!wallet) {
    return {
      ok: false,
      replyKind: "nft_wallet_missing",
      replyText: "You need a Solana wallet linked to mint NFTs. Set one up in the SOLMate dashboard.",
    };
  }

  const image = await resolveImageUrl(input.admin, input.tweet);

  if (input.command.kind === "create_collection") {
    if (!image.url) {
      return {
        ok: false,
        replyKind: "nft_collection_image_missing",
        replyText:
          "Attach an image (or tag me under a post that has one) so I can mint the collection artwork.",
      };
    }
    let hostedImage: string;
    try {
      hostedImage = await rehostNftImage(input.admin, image.url);
    } catch (error) {
      return {
        ok: false,
        replyKind: "nft_image_unusable",
        replyText: `Couldn't read that image: ${String((error as Error).message).slice(0, 80)}`,
      };
    }

    // If the user didn't provide a description, let the AI invent a short
    // neutral one. Falls back to a static line if the AI call fails.
    let description = input.command.description ?? null;
    if (!description) {
      description = await generateCollectionDescriptionWithAi(
        input.command.name,
        input.command.symbol,
        input.tweet?.text ?? null,
      );
      if (!description) {
        description = `${input.command.name} — a Solana NFT collection minted via @linkrcash.`;
      }
    }

    const insert = await input.admin
      .from("nft_collections")
      .insert({
        user_id: input.userId,
        wallet_id: wallet.id,
        name: input.command.name,
        symbol: input.command.symbol,
        description,
        image_url: hostedImage,
        website_url: input.command.websiteUrl,
        twitter_url: input.command.twitterUrl,
        telegram_url: input.command.telegramUrl,
        source_tweet_id: input.tweetId,
        status: "pending",
      })
      .select("id")
      .single();
    if (insert.error) throw insert.error;
    const collectionRowId = insert.data.id as string;

    try {
      const { mintCollection } = await import("./solana_nft/mint.ts");
      const result = await mintCollection({
        admin: input.admin,
        walletId: wallet.id,
        userId: input.userId,
        name: input.command.name,
        symbol: input.command.symbol,
        description,
        imageUrl: hostedImage,
        websiteUrl: input.command.websiteUrl,
        twitterUrl: input.command.twitterUrl,
        telegramUrl: input.command.telegramUrl,
        externalUrl: input.command.websiteUrl,
      });
      await input.admin
        .from("nft_collections")
        .update({
          status: "confirmed",
          mint_address: result.mintAddress,
          metadata_uri: result.metadataUri,
          signature: result.signature,
          explorer_url: result.explorerUrl,
          error: null,
        })
        .eq("id", collectionRowId);
      return {
        ok: true,
        replyKind: "nft_collection_minted",
        replyText: trim(
          `Minted collection ${input.command.name} ✅ https://solmate.live/nfts/${collectionRowId}`,
        ),
      };
    } catch (error) {
      const message = String((error as Error).message ?? error);
      await input.admin
        .from("nft_collections")
        .update({ status: "failed", error: message.slice(0, 500) })
        .eq("id", collectionRowId);
      if (message.startsWith("insufficient_sol_for_nft")) {
        return {
          ok: false,
          replyKind: "nft_insufficient_funds",
          replyText: trim(
            `Not enough SOL to mint the collection. Fund the wallet with at least ${NFT_MIN_REQUIRED_SOL} SOL and try again.`,
          ),
        };
      }
      return {
        ok: false,
        replyKind: "nft_collection_failed",
        replyText: trim(`Couldn't mint collection: ${message.slice(0, 120)}`),
      };
    }
  }

  // mint_nft
  const collection = await findCollection(input.admin, input.userId, input.command.collectionQuery);
  if (!collection) {
    return {
      ok: false,
      replyKind: "nft_collection_not_found",
      replyText: trim(
        `I couldn't find a confirmed collection called "${input.command.collectionQuery}". Mint the collection first.`,
      ),
    };
  }
  if (!image.url) {
    return {
      ok: false,
      replyKind: "nft_image_missing",
      replyText:
        "Attach an image on your post, or tag me under a post that has one, so I know what to mint.",
    };
  }
  let hostedImage: string;
  try {
    hostedImage = await rehostNftImage(input.admin, image.url);
  } catch (error) {
    return {
      ok: false,
      replyKind: "nft_image_unusable",
      replyText: `Couldn't read that image: ${String((error as Error).message).slice(0, 80)}`,
    };
  }

  const nftName = (input.command.name ?? `${collection.name} #${Date.now().toString().slice(-4)}`).slice(0, 32);

  const insert = await input.admin
    .from("nft_mints")
    .insert({
      user_id: input.userId,
      wallet_id: wallet.id,
      collection_id: collection.id,
      name: nftName,
      image_url: hostedImage,
      source_tweet_id: input.tweetId,
      image_source: image.source,
      status: "pending",
    })
    .select("id")
    .single();
  if (insert.error) throw insert.error;
  const mintRowId = insert.data.id as string;

  try {
    const { mintNftIntoCollection } = await import("./solana_nft/mint.ts");
    const result = await mintNftIntoCollection({
      admin: input.admin,
      walletId: wallet.id,
      userId: input.userId,
      collection: {
        mintAddress: collection.mint_address,
        name: collection.name,
        symbol: collection.symbol,
      },
      name: nftName,
      imageUrl: hostedImage,
    });
    await input.admin
      .from("nft_mints")
      .update({
        status: "confirmed",
        mint_address: result.mintAddress,
        metadata_uri: result.metadataUri,
        signature: result.signature,
        explorer_url: result.explorerUrl,
        error: null,
      })
      .eq("id", mintRowId);
    return {
      ok: true,
      replyKind: "nft_minted",
      replyText: trim(
        `Minted NFT into ${collection.name} ✅ https://solmate.live/nfts/${collection.id}`,
      ),
    };
  } catch (error) {
    const message = String((error as Error).message ?? error);
    await input.admin
      .from("nft_mints")
      .update({ status: "failed", error: message.slice(0, 500) })
      .eq("id", mintRowId);
    if (message.startsWith("insufficient_sol_for_nft")) {
      return {
        ok: false,
        replyKind: "nft_insufficient_funds",
        replyText: trim(
          `Not enough SOL to mint the NFT. Fund the wallet with at least ${NFT_MIN_REQUIRED_SOL} SOL and try again.`,
        ),
      };
    }
    return {
      ok: false,
      replyKind: "nft_mint_failed",
      replyText: trim(`Couldn't mint NFT: ${message.slice(0, 120)}`),
    };
  }
}

async function rehostNftImage(admin: any, sourceUrl: string): Promise<string> {
  const captured = await captureBoundedExternalImage(sourceUrl);
  const stored = await storeCapturedImage(admin, captured);
  captured.bytes.fill(0);
  return stored.publicUrl;
}