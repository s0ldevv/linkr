export const DEFAULT_API_URL = "https://linkr.cash";

export type ApiUrlSource = "default" | "option" | "env" | "credentials";

export type ApiUrlResolution = {
  apiUrl: string;
  source: ApiUrlSource;
  input?: string;
  normalizedFrom?: string;
};

export function resolveApiUrl(
  options: {
    apiUrl?: string | null;
    env?: { LINKR_API_URL?: string };
  } = {},
): ApiUrlResolution {
  const optionValue = options.apiUrl?.trim();
  if (optionValue) return normalizeApiUrl(optionValue, "option");

  const envValue = options.env?.LINKR_API_URL?.trim();
  if (envValue) return normalizeApiUrl(envValue, "env");

  return { apiUrl: DEFAULT_API_URL, source: "default" };
}

export function normalizeStoredApiUrl(value: string): string {
  return normalizeApiUrl(value, "credentials").apiUrl;
}

export function normalizeApiUrl(input: string, source: ApiUrlSource = "option"): ApiUrlResolution {
  const raw = String(input ?? "").trim();
  if (!raw) {
    throw new Error(`Linkr API URL is empty. Use ${DEFAULT_API_URL}.`);
  }

  const url = parseApiUrl(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Invalid Linkr API URL "${raw}". Use an http or https URL.`);
  }
  if (url.username || url.password) {
    throw new Error(`Invalid Linkr API URL "${raw}". Do not include credentials in the URL.`);
  }
  if (url.search || url.hash) {
    throw new Error(`Invalid Linkr API URL "${raw}". Do not include a query string or fragment.`);
  }

  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const apiPathProvided = pathname === "/api" || pathname.startsWith("/api/");
  if (pathname !== "/" && !apiPathProvided) {
    throw new Error(
      `Invalid Linkr API URL "${raw}". Use the site origin, for example ${DEFAULT_API_URL}.`,
    );
  }

  const apiUrl = `${url.protocol}//${url.host}`;
  const normalizedFrom = raw === apiUrl ? undefined : raw;
  return { apiUrl, source, input: raw, normalizedFrom };
}

export function describeApiUrlResolution(resolution: ApiUrlResolution): string | null {
  if (resolution.source === "default" && !resolution.normalizedFrom) return null;
  if (resolution.normalizedFrom) {
    return `Using Linkr API: ${resolution.apiUrl} (normalized from ${resolution.normalizedFrom})`;
  }
  return `Using Linkr API: ${resolution.apiUrl}`;
}

function parseApiUrl(value: string): URL {
  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(value)) {
    return new URL(`http://${value}`);
  }
  if (/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}(:\d+)?(\/.*)?$/.test(value)) {
    return new URL(`https://${value}`);
  }
  try {
    return new URL(value);
  } catch {
    throw new Error(`Invalid Linkr API URL "${value}". Use a full URL such as ${DEFAULT_API_URL}.`);
  }
}
