// deno-lint-ignore-file no-explicit-any
// Solana NFT minting via Metaplex Core (mpl-core). Uses UMI which is
// intentionally lightweight and Deno/edge-friendly — the legacy
// mpl-token-metadata + @solana/spl-token + @solana/web3.js path blew the
// worker boot CPU cap (WORKER_RESOURCE_LIMIT) and paused the stage.
//
// This module is dynamically imported from x_nft_execute.ts, so the heavy
// npm graph only loads when an NFT job is actually claimed.

import {
  createCollection,
  create as createAsset,
} from "npm:@metaplex-foundation/mpl-core@1.1.1";
import { createUmi } from "npm:@metaplex-foundation/umi-bundle-defaults@1.0.0";
import {
  generateSigner,
  keypairIdentity,
  publicKey as toUmiPublicKey,
  type Umi,
} from "npm:@metaplex-foundation/umi@1.0.0";

import {
  base58Encode,
  getSolanaTxExplorerUrl,
  LAMPORTS_PER_SOL,
  loadSolanaWalletById,
  requiredSolanaRpcUrl,
  type LoadedSolanaWallet,
} from "../solana_chain.ts";

// Rough SOL floor: parent collection asset rent + royalties plugin state +
// fee + a small buffer. mpl-core assets are single-account (~0.0037 SOL) so
// this covers both create-collection and mint-into flows comfortably.
export const NFT_MIN_REQUIRED_SOL = 0.02;

export interface MintCollectionInput {
  admin: any;
  walletId: string;
  userId: string;
  name: string;
  symbol: string;
  description?: string | null;
  imageUrl: string;
  websiteUrl?: string | null;
  twitterUrl?: string | null;
  telegramUrl?: string | null;
  externalUrl?: string | null;
}

export interface MintCollectionResult {
  mintAddress: string;
  signature: string;
  explorerUrl: string;
  metadataUri: string;
}

export interface MintNftInput {
  admin: any;
  walletId: string;
  userId: string;
  collection: {
    mintAddress: string;
    name: string;
    symbol: string;
  };
  name: string;
  imageUrl: string;
  description?: string | null;
  externalUrl?: string | null;
}

export interface MintNftResult {
  mintAddress: string;
  signature: string;
  explorerUrl: string;
  metadataUri: string;
}

function buildUmi(wallet: LoadedSolanaWallet): Umi {
  const umi = createUmi(requiredSolanaRpcUrl(), { commitment: "confirmed" });
  const kp = umi.eddsa.createKeypairFromSecretKey(wallet.secret_key);
  umi.use(keypairIdentity(kp));
  return umi;
}

async function preflightBalance(umi: Umi) {
  const balance = await umi.rpc.getBalance(umi.identity.publicKey);
  const lamports = Number(balance.basisPoints);
  const required = Math.ceil(NFT_MIN_REQUIRED_SOL * LAMPORTS_PER_SOL);
  if (lamports < required) {
    throw new Error(
      `insufficient_sol_for_nft:need_${NFT_MIN_REQUIRED_SOL}_have_${
        (lamports / LAMPORTS_PER_SOL).toFixed(4)
      }`,
    );
  }
}

async function uploadJsonMetadata(admin: any, body: Record<string, unknown>) {
  const bytes = new TextEncoder().encode(JSON.stringify(body, null, 2));
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer);
  const sha = [...new Uint8Array(digest)]
    .map((v) => v.toString(16).padStart(2, "0")).join("");
  // token-logos bucket restricts allowed_mime_types to images. Upload the
  // metadata JSON with an image content-type header so the bucket accepts
  // it — wallets/explorers fetch the URI and parse the body as JSON
  // regardless of the response content-type.
  const path = `nft-metadata/${sha}.json`;
  const { error } = await admin.storage.from("token-logos").upload(
    path,
    bytes,
    {
      contentType: "image/png",
      cacheControl: "31536000",
      upsert: false,
    },
  );
  if (error && !/already exists|duplicate/i.test(String(error.message ?? error))) {
    throw error;
  }
  const { data } = admin.storage.from("token-logos").getPublicUrl(path);
  if (!data?.publicUrl) throw new Error("nft_metadata_url_missing");
  return data.publicUrl;
}

function encodeSignature(sig: unknown): string {
  if (sig instanceof Uint8Array) return base58Encode(sig);
  if (Array.isArray(sig)) return base58Encode(Uint8Array.from(sig as number[]));
  return String(sig ?? "");
}

export async function mintCollection(
  input: MintCollectionInput,
): Promise<MintCollectionResult> {
  const wallet = await loadSolanaWalletById(input.admin, input.walletId, input.userId);
  if (!wallet) throw new Error("solana_wallet_not_found");

  const umi = buildUmi(wallet);
  await preflightBalance(umi);

  const metadataUri = await uploadJsonMetadata(input.admin, {
    name: input.name,
    symbol: input.symbol,
    description: input.description ??
      `${input.name} — NFT collection minted via @linkrcash on Solana`,
    image: input.imageUrl,
    external_url: input.externalUrl ?? input.websiteUrl ?? null,
    seller_fee_basis_points: 500,
    properties: {
      files: [{ uri: input.imageUrl, type: "image/png" }],
      category: "image",
      creators: [{ address: wallet.address, share: 100 }],
    },
    attributes: [
      ...(input.websiteUrl ? [{ trait_type: "website", value: input.websiteUrl }] : []),
      ...(input.twitterUrl ? [{ trait_type: "twitter", value: input.twitterUrl }] : []),
      ...(input.telegramUrl ? [{ trait_type: "telegram", value: input.telegramUrl }] : []),
    ],
  });

  const collectionSigner = generateSigner(umi);
  const tx = await createCollection(umi, {
    collection: collectionSigner,
    name: input.name.slice(0, 32),
    uri: metadataUri.slice(0, 200),
    plugins: [
      {
        type: "Royalties",
        basisPoints: 500,
        creators: [{ address: umi.identity.publicKey, percentage: 100 }],
        ruleSet: { type: "None" },
      },
    ],
  }).sendAndConfirm(umi, { confirm: { commitment: "confirmed" } });

  const signature = encodeSignature(tx.signature);
  const mintAddress = collectionSigner.publicKey.toString();

  return {
    mintAddress,
    signature,
    explorerUrl: getSolanaTxExplorerUrl(signature),
    metadataUri,
  };
}

export async function mintNftIntoCollection(
  input: MintNftInput,
): Promise<MintNftResult> {
  const wallet = await loadSolanaWalletById(input.admin, input.walletId, input.userId);
  if (!wallet) throw new Error("solana_wallet_not_found");

  const umi = buildUmi(wallet);
  await preflightBalance(umi);

  const metadataUri = await uploadJsonMetadata(input.admin, {
    name: input.name,
    symbol: input.collection.symbol,
    description: input.description ??
      `Minted into ${input.collection.name} via @linkrcash on Solana`,
    image: input.imageUrl,
    external_url: input.externalUrl ?? null,
    collection: { name: input.collection.name, family: input.collection.name },
    properties: {
      files: [{ uri: input.imageUrl, type: "image/png" }],
      category: "image",
      creators: [{ address: wallet.address, share: 100 }],
    },
  });

  const assetSigner = generateSigner(umi);
  const tx = await createAsset(umi, {
    asset: assetSigner,
    collection: {
      publicKey: toUmiPublicKey(input.collection.mintAddress),
    } as any,
    name: input.name.slice(0, 32),
    uri: metadataUri.slice(0, 200),
  }).sendAndConfirm(umi, { confirm: { commitment: "confirmed" } });

  const signature = encodeSignature(tx.signature);
  const mintAddress = assetSigner.publicKey.toString();

  return {
    mintAddress,
    signature,
    explorerUrl: getSolanaTxExplorerUrl(signature),
    metadataUri,
  };
}