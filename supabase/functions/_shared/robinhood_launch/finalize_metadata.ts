// deno-lint-ignore-file no-explicit-any
import { readMetadataTestingPolicy } from "../admin_settings.ts";
import { resolvePumpFunLaunchMetadata } from "../launch_metadata.ts";
import { refreshLaunchMetadataAtPath } from "./assets.ts";

export async function refreshRobinhoodLaunchMetadataForToken(
  admin: any,
  launch: any,
  tokenAddress: string,
): Promise<any> {
  if (
    !String(launch.token_metadata_storage_path ?? "").trim() ||
    String(launch.metadata_storage_provider ?? "") !== "supabase"
  ) {
    return launch;
  }

  const metadataPolicy = await readMetadataTestingPolicy(admin);
  const metadata = resolvePumpFunLaunchMetadata(launch, {
    testingMode: metadataPolicy.enabled,
    testingWebsiteUrl: metadataPolicy.test_website_url,
    testingTwitterUrl: metadataPolicy.test_twitter_url,
    testingTelegramUrl: metadataPolicy.test_telegram_url,
    mintAddress: tokenAddress,
  });
  const refreshed = await refreshLaunchMetadataAtPath(admin, {
    launchId: launch.id,
    name: launch.name,
    symbol: launch.symbol,
    description: launch.description,
    imageUrl: launch.stable_logo_url ?? launch.image_url,
    imageGatewayUrl: launch.stable_logo_url ?? launch.image_url,
    tokenMetadataStoragePath: launch.token_metadata_storage_path,
    website: metadata.websiteUrl,
    twitter: metadata.twitterUrl,
    telegram: metadata.telegramUrl,
    externalUrl: metadata.websiteUrl,
  });

  const launchMetadata = isRecord(launch.launch_metadata)
    ? { ...launch.launch_metadata }
    : {};
  launchMetadata.robinhood_metadata_token_address = tokenAddress;
  launchMetadata.robinhood_metadata_website = metadata.websiteUrl;

  const update: Record<string, unknown> = {
    launch_metadata: launchMetadata,
  };
  if (refreshed.uri !== launch.metadata_uri) update.metadata_uri = refreshed.uri;
  if (refreshed.hash !== launch.token_metadata_hash) {
    update.token_metadata_hash = refreshed.hash;
  }

  const updated = await admin.from("coin_launches").update(update)
    .eq("id", launch.id).select("*").single();
  if (updated.error) throw updated.error;
  return updated.data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
