export function isRetryableXPostFailure(
  status: number,
  payload: unknown,
): boolean {
  if (status === 403 && isDefinitiveReplyTargetFailure(payload)) return false;
  if (status === 403 && isCryptoAddressBlockedFailure(payload)) return false;
  return status === 401 || status === 403 || status === 408 || status === 409 ||
    status === 425 || status === 429 || status >= 500;
}

export function isDefinitiveReplyTargetFailure(payload: unknown): boolean {
  const text = JSON.stringify(payload ?? {}).toLowerCase();
  return /deleted|not visible|cannot (?:reply|be replied)|reply permissions|tweet not found/
    .test(
      text,
    );
}

// X blocks posts containing crypto addresses for 7 days after re-authentication.
// The filter never lifts on retry, so treat as terminal.
export function isCryptoAddressBlockedFailure(payload: unknown): boolean {
  const text = JSON.stringify(payload ?? {}).toLowerCase();
  return /crypto address(?:es)? (?:are )?prohibited/.test(text) ||
    /crypto.*prohibited.*7 days/.test(text);
}

// Strip base58 Solana-style addresses so a fallback reply survives the filter.
export function stripCryptoAddresses(text: string): string {
  return text
    .replace(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g, "")
    .replace(/\bCA:\s*/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}
