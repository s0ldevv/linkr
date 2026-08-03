export type PublicLaunchImageFields = {
  imageUrl?: unknown;
  originalImageUrl?: unknown;
  stableLogoUrl?: unknown;
  tokenLogoStoragePath?: unknown;
};

export function resolvePublicLaunchImageUrl(
  fields: PublicLaunchImageFields,
  supabaseUrl: string | null | undefined,
): string | null {
  const storagePath = cleanStoragePath(fields.tokenLogoStoragePath);
  const projectUrl = validHttpsUrl(supabaseUrl);
  if (storagePath && projectUrl) {
    const encodedPath = storagePath.split("/").map(encodeURIComponent).join(
      "/",
    );
    return `${
      projectUrl.replace(/\/$/, "")
    }/storage/v1/object/public/token-logos/${encodedPath}`;
  }

  return firstValidHttpsUrl(
    fields.stableLogoUrl,
    fields.imageUrl,
    fields.originalImageUrl,
  );
}

function cleanStoragePath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const path = value.trim().replace(/^\/+/, "");
  if (!path || path.includes("..") || path.includes("\\")) return null;
  return path;
}

function firstValidHttpsUrl(...values: unknown[]): string | null {
  for (const value of values) {
    const url = validHttpsUrl(value);
    if (url) return url;
  }
  return null;
}

function validHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
