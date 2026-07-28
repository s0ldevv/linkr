// deno-lint-ignore-file no-explicit-any

import { copyLaunchLogoBytesToStorage, fetchLaunchImage } from "./media.ts";
import {
  buildLaunchMetadata,
  createLaunchMetadataUri,
  createLaunchMetadataUriAtPath,
  type LaunchMetadataInput,
} from "./metadata.ts";
import {
  ipfsUploadEnabled,
  ipfsUploadRequired,
  uploadLaunchImageToIpfs,
  uploadLaunchMetadataToIpfs,
} from "./ipfs.ts";

export type PreparedLaunchAssets = {
  imageUrl: string;
  stableLogoUrl: string;
  originalImageUrl: string;
  tokenLogoStoragePath: string | null;
  metadataUri: string;
  tokenMetadataStoragePath: string | null;
  tokenMetadataHash: string | null;
  metadataStorageProvider: "filebase" | "supabase";
  metadataStorageError: string | null;
  ipfsImageUri: string | null;
  ipfsImageCid: string | null;
  ipfsImageGatewayUrl: string | null;
  ipfsMetadataUri: string | null;
  ipfsMetadataCid: string | null;
  ipfsMetadataGatewayUrl: string | null;
  filebaseImageObjectKey: string | null;
  filebaseMetadataObjectKey: string | null;
  metadata: Record<string, unknown>;
};

export async function prepareLaunchAssets(
  admin: any,
  args: {
    launchId: string;
    name: string;
    symbol: string;
    description?: string | null;
    imageUrl: string;
    website?: string | null;
    twitter?: string | null;
    telegram?: string | null;
    externalUrl?: string | null;
  },
): Promise<PreparedLaunchAssets> {
  const asset = await fetchLaunchImage({
    imageUrl: args.imageUrl,
    symbol: args.symbol,
    launchId: args.launchId,
  });
  const logo = await copyLaunchLogoBytesToStorage(admin, asset);

  if (ipfsUploadEnabled()) {
    try {
      const ipfsImage = await uploadLaunchImageToIpfs({
        bytes: asset.bytes,
        contentType: asset.contentType,
        filename: asset.filename,
        launchId: args.launchId,
        symbol: args.symbol,
      });
      const ipfsMetadataInput = buildMetadataInput(args, {
        image: ipfsImage.uri,
        imageGatewayUrl: ipfsImage.gatewayUrl,
        imageMime: asset.contentType,
        storageProvider: "filebase",
        ipfsImageCid: ipfsImage.cid,
        ipfsImageUri: ipfsImage.uri,
        filebaseImageObjectKey: ipfsImage.objectKey,
      });
      const metadata = buildLaunchMetadata(ipfsMetadataInput);
      const ipfsMetadata = await uploadLaunchMetadataToIpfs({
        metadata,
        filename: "metadata.json",
        launchId: args.launchId,
        symbol: args.symbol,
      });
      const supabaseMetadata = await createLaunchMetadataUri(
        admin,
        ipfsMetadataInput,
      );

      return {
        imageUrl: ipfsImage.gatewayUrl,
        stableLogoUrl: ipfsImage.gatewayUrl,
        originalImageUrl: asset.sourceUrl,
        tokenLogoStoragePath: logo.path,
        metadataUri: ipfsMetadata.uri,
        tokenMetadataStoragePath: supabaseMetadata.path,
        tokenMetadataHash: supabaseMetadata.hash,
        metadataStorageProvider: "filebase",
        metadataStorageError: null,
        ipfsImageUri: ipfsImage.uri,
        ipfsImageCid: ipfsImage.cid,
        ipfsImageGatewayUrl: ipfsImage.gatewayUrl,
        ipfsMetadataUri: ipfsMetadata.uri,
        ipfsMetadataCid: ipfsMetadata.cid,
        ipfsMetadataGatewayUrl: ipfsMetadata.gatewayUrl,
        filebaseImageObjectKey: ipfsImage.objectKey,
        filebaseMetadataObjectKey: ipfsMetadata.objectKey,
        metadata,
      };
    } catch (error) {
      if (ipfsUploadRequired()) {
        throw new Error(
          `ipfs_launch_asset_upload_failed:${sanitizeError(error)}`,
        );
      }
      return await prepareSupabaseAssets(
        admin,
        args,
        logo.publicUrl,
        logo.path,
        asset.sourceUrl,
        sanitizeError(error),
      );
    }
  }

  return await prepareSupabaseAssets(
    admin,
    args,
    logo.publicUrl,
    logo.path,
    asset.sourceUrl,
    null,
  );
}

export async function prepareLaunchSupabaseAssetsAtStablePath(
  admin: any,
  args: {
    launchId: string;
    name: string;
    symbol: string;
    description?: string | null;
    imageUrl: string;
    website?: string | null;
    twitter?: string | null;
    telegram?: string | null;
    externalUrl?: string | null;
  },
): Promise<PreparedLaunchAssets> {
  const asset = await fetchLaunchImage({
    imageUrl: args.imageUrl,
    symbol: args.symbol,
    launchId: args.launchId,
  });
  const logo = await copyLaunchLogoBytesToStorage(admin, asset);
  return await prepareSupabaseAssets(
    admin,
    args,
    logo.publicUrl,
    logo.path,
    asset.sourceUrl,
    null,
    stableMetadataPath(args.symbol, args.launchId),
  );
}

export async function refreshLaunchMetadataAtPath(
  admin: any,
  args: {
    launchId: string;
    name: string;
    symbol: string;
    description?: string | null;
    imageUrl: string;
    imageGatewayUrl?: string | null;
    tokenMetadataStoragePath: string;
    website?: string | null;
    twitter?: string | null;
    telegram?: string | null;
    externalUrl?: string | null;
  },
): Promise<
  { uri: string; path: string; metadata: Record<string, unknown>; hash: string }
> {
  return await createLaunchMetadataUriAtPath(
    admin,
    buildMetadataInput(args, {
      image: args.imageUrl,
      imageGatewayUrl: args.imageGatewayUrl ?? args.imageUrl,
      storageProvider: "supabase",
    }),
    args.tokenMetadataStoragePath,
  );
}

async function prepareSupabaseAssets(
  admin: any,
  args: {
    launchId: string;
    name: string;
    symbol: string;
    description?: string | null;
    website?: string | null;
    twitter?: string | null;
    telegram?: string | null;
    externalUrl?: string | null;
  },
  logoPublicUrl: string,
  logoPath: string,
  originalImageUrl: string,
  storageError: string | null,
  metadataPath?: string | null,
): Promise<PreparedLaunchAssets> {
  const metadataInput = buildMetadataInput(args, {
    image: logoPublicUrl,
    imageGatewayUrl: logoPublicUrl,
    storageProvider: "supabase",
  });
  const metadataUpload = metadataPath
    ? await createLaunchMetadataUriAtPath(admin, metadataInput, metadataPath)
    : await createLaunchMetadataUri(admin, metadataInput);

  return {
    imageUrl: logoPublicUrl,
    stableLogoUrl: logoPublicUrl,
    originalImageUrl,
    tokenLogoStoragePath: logoPath,
    metadataUri: metadataUpload.uri,
    tokenMetadataStoragePath: metadataUpload.path,
    tokenMetadataHash: metadataUpload.hash,
    metadataStorageProvider: "supabase",
    metadataStorageError: storageError,
    ipfsImageUri: null,
    ipfsImageCid: null,
    ipfsImageGatewayUrl: null,
    ipfsMetadataUri: null,
    ipfsMetadataCid: null,
    ipfsMetadataGatewayUrl: null,
    filebaseImageObjectKey: null,
    filebaseMetadataObjectKey: null,
    metadata: metadataUpload.metadata,
  };
}

function buildMetadataInput(
  args: {
    launchId: string;
    name: string;
    symbol: string;
    description?: string | null;
    website?: string | null;
    twitter?: string | null;
    telegram?: string | null;
    externalUrl?: string | null;
  },
  storage: {
    image: string;
    imageGatewayUrl?: string | null;
    imageMime?: string | null;
    storageProvider: "filebase" | "supabase";
    ipfsImageCid?: string | null;
    ipfsImageUri?: string | null;
    filebaseImageObjectKey?: string | null;
  },
): LaunchMetadataInput {
  return {
    launchId: args.launchId,
    name: args.name,
    symbol: args.symbol,
    description: args.description ?? "",
    image: storage.image,
    imageGatewayUrl: storage.imageGatewayUrl ?? null,
    imageMime: storage.imageMime ?? null,
    externalUrl: args.externalUrl ?? null,
    website: args.website ?? null,
    twitter: args.twitter ?? null,
    telegram: args.telegram ?? null,
    storageProvider: storage.storageProvider,
    ipfsImageCid: storage.ipfsImageCid ?? null,
    ipfsImageUri: storage.ipfsImageUri ?? null,
    filebaseImageObjectKey: storage.filebaseImageObjectKey ?? null,
  };
}

function sanitizeError(error: unknown): string {
  return String(error instanceof Error ? error.message : error)
    .replace(/(AWS4-HMAC-SHA256 Credential=)[^,\s]+/gi, "$1[redacted]")
    .replace(/(Signature=)[a-f0-9]+/gi, "$1[redacted]")
    .slice(0, 500);
}

function stableMetadataPath(symbol: string, launchId: string): string {
  return `${sanitizePathSegment(symbol || "token")}/${
    sanitizePathSegment(launchId || crypto.randomUUID())
  }.json`;
}

function sanitizePathSegment(value: string): string {
  const safe = String(value ?? "")
    .replace(/[^a-z0-9-]/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return safe || "token";
}
