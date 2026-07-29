import assert from "node:assert/strict";
import test from "node:test";
import { LinkrApiError } from "./api.js";
import { formatCliError } from "./errors.js";

test("formatCliError gives api_route_not_found users an API URL fix", () => {
  const message = formatCliError(
    new LinkrApiError(
      "API route not found.",
      "api_route_not_found",
      404,
      "https://linkr.cash/api/api/cli/auth/start",
    ),
  );

  assert.match(message, /https:\/\/linkr\.cash, not https:\/\/linkr\.cash\/api/);
  assert.match(message, /Requested: https:\/\/linkr\.cash\/api\/api\/cli\/auth\/start/);
});
