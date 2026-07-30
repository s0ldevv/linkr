const LINKR_HANDLE = "linkrbot";

export function normalizeProfileHandle(handle: string | null | undefined): string | null {
  const username = handle?.trim().replace(/^@/, "");
  if (!username || !/^[A-Za-z0-9_]{1,15}$/.test(username)) return null;
  return username;
}

export function isLinkrHandle(handle: string | null | undefined): boolean {
  return normalizeProfileHandle(handle)?.toLowerCase() === LINKR_HANDLE;
}
