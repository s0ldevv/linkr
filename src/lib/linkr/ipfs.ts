const DEFAULT_IPFS_GATEWAY = "https://ipfs.filebase.io/ipfs";

export function configuredIpfsGateway(): string {
  const configured = import.meta.env.VITE_IPFS_GATEWAY_URL;
  return String(configured || DEFAULT_IPFS_GATEWAY).replace(/\/+$/, "");
}

export function resolveIpfsUrl(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  if (/^ipfs:\/\//i.test(raw)) {
    const path = raw
      .replace(/^ipfs:\/\//i, "")
      .replace(/^ipfs\//i, "")
      .replace(/^\/+/, "");
    return path ? `${configuredIpfsGateway()}/${path}` : null;
  }

  if (raw.startsWith("//")) return `https:${raw}`;

  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
