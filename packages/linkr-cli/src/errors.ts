import { LinkrApiError } from "./api.js";
import { DEFAULT_API_URL } from "./api-url.js";

export function formatCliError(error: unknown): string {
  if (error instanceof LinkrApiError) {
    if (error.code === "api_route_not_found") {
      const requested = error.url ? `\nRequested: ${error.url}` : "";
      return [
        error.message,
        requested,
        "",
        "The CLI reached Linkr, but the API route was not found.",
        `Check --api-url or LINKR_API_URL. Use ${DEFAULT_API_URL}, not ${DEFAULT_API_URL}/api.`,
        "The CLI adds /api/cli/... automatically.",
      ]
        .filter(Boolean)
        .join("\n");
    }
    return error.message;
  }

  if (
    error instanceof TypeError &&
    /fetch failed|failed to parse url|invalid url/i.test(error.message)
  ) {
    return [
      error.message,
      "",
      "Could not reach the Linkr API. Check your internet connection and API URL.",
      `For production, use ${DEFAULT_API_URL}.`,
    ].join("\n");
  }

  return error instanceof Error ? error.message : String(error);
}
