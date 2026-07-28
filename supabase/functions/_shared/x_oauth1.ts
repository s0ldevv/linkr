export interface XOAuth1Credentials {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

export interface XOAuth1SignOptions {
  method: string;
  url: string;
  credentials: XOAuth1Credentials;
  nonce?: string;
  timestamp?: number;
  formParameters?: Array<[string, string]>;
  allowInsecureForTesting?: boolean;
  includeVersion?: boolean;
}

type EnvReader = (name: string) => string | undefined;

const encoder = new TextEncoder();

function requiredEnv(name: string, readEnv: EnvReader): string {
  const value = readEnv(name);
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export function loadXOAuth1Credentials(
  readEnv: EnvReader = (name) => Deno.env.get(name),
): XOAuth1Credentials {
  return {
    consumerKey: requiredEnv("X_OAUTH1_CONSUMER_KEY", readEnv),
    consumerSecret: requiredEnv("X_OAUTH1_CONSUMER_SECRET", readEnv),
    accessToken: requiredEnv("X_OAUTH1_ACCESS_TOKEN", readEnv),
    accessTokenSecret: requiredEnv("X_OAUTH1_ACCESS_TOKEN_SECRET", readEnv),
  };
}

export function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toBase64(bytes: ArrayBuffer): string {
  const values = new Uint8Array(bytes);
  let binary = "";
  for (const value of values) binary += String.fromCharCode(value);
  return btoa(binary);
}

function baseUrl(url: URL): string {
  const protocol = url.protocol.toLowerCase();
  const hostname = url.hostname.toLowerCase();
  const defaultPort =
    (protocol === "https:" && url.port === "443") || (protocol === "http:" && url.port === "80");
  const authority = defaultPort || !url.port ? hostname : `${hostname}:${url.port}`;
  return `${protocol}//${authority}${url.pathname || "/"}`;
}

function normalizedParameters(parameters: Array<[string, string]>): string {
  return parameters
    .map(([key, value]) => [percentEncode(key), percentEncode(value)] as [string, string])
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      const keyOrder = leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
      if (keyOrder !== 0) return keyOrder;
      return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
    })
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

async function hmacSha1Base64(keyValue: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(keyValue),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  return toBase64(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

export async function createXOAuth1AuthorizationHeader(
  options: XOAuth1SignOptions,
): Promise<string> {
  const method = String(options.method ?? "")
    .trim()
    .toUpperCase();
  if (!method) throw new Error("OAuth 1.0a request method is required");

  const url = new URL(options.url);
  if (url.protocol !== "https:" && !options.allowInsecureForTesting) {
    throw new Error("OAuth 1.0a requests require HTTPS");
  }

  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  if (!Number.isInteger(timestamp) || timestamp <= 0) {
    throw new Error("OAuth 1.0a timestamp must be a positive Unix timestamp");
  }
  const nonce = options.nonce ?? randomNonce();
  if (!nonce) throw new Error("OAuth 1.0a nonce is required");

  const oauthParameters: Array<[string, string]> = [
    ["oauth_consumer_key", options.credentials.consumerKey],
    ["oauth_nonce", nonce],
    ["oauth_signature_method", "HMAC-SHA1"],
    ["oauth_timestamp", String(timestamp)],
    ["oauth_token", options.credentials.accessToken],
  ];
  if (options.includeVersion !== false) oauthParameters.push(["oauth_version", "1.0"]);

  const signatureParameters: Array<[string, string]> = [...oauthParameters];
  for (const [key, value] of url.searchParams.entries()) {
    signatureParameters.push([key, value]);
  }
  for (const [key, value] of options.formParameters ?? []) {
    signatureParameters.push([key, value]);
  }

  const parameterString = normalizedParameters(signatureParameters);
  const signatureBaseString = [method, baseUrl(url), parameterString].map(percentEncode).join("&");
  const signingKey = `${percentEncode(options.credentials.consumerSecret)}&${percentEncode(
    options.credentials.accessTokenSecret,
  )}`;
  const signature = await hmacSha1Base64(signingKey, signatureBaseString);

  return `OAuth ${[...oauthParameters, ["oauth_signature", signature] as [string, string]]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${percentEncode(key)}="${percentEncode(value)}"`)
    .join(", ")}`;
}
