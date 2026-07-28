import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { sensitiveCorsHeaders, withSensitiveCors } from "./cors.ts";
import { verifyTelegramWebhookRequest } from "./telegram.ts";

function withEnv(name: string, value: string | undefined, run: () => void) {
  const previous = Deno.env.get(name);
  try {
    if (value === undefined) Deno.env.delete(name);
    else Deno.env.set(name, value);
    run();
  } finally {
    if (previous === undefined) Deno.env.delete(name);
    else Deno.env.set(name, previous);
  }
}

Deno.test("sensitive CORS reflects exact allowed origins only", () => {
  withEnv("LINKR_BROWSER_ORIGINS", "https://staging.linkr.cash", () => {
    const allowed = sensitiveCorsHeaders(
      new Request("https://edge.test", {
        headers: { Origin: "https://staging.linkr.cash" },
      }),
    );
    assertEquals(
      allowed["Access-Control-Allow-Origin"],
      "https://staging.linkr.cash",
    );
    assertEquals(allowed.Vary, "Origin");

    const lookalike = sensitiveCorsHeaders(
      new Request("https://edge.test", {
        headers: { Origin: "https://staging.linkr.cash.evil" },
      }),
    );
    assertFalse("Access-Control-Allow-Origin" in lookalike);
  });
});

Deno.test("sensitive CORS removes a legacy wildcard", () => {
  const response = withSensitiveCors(
    new Request("https://edge.test", { headers: { Origin: "null" } }),
    new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } }),
  );
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), null);
  assertEquals(response.headers.get("Vary"), "Origin");
});

Deno.test("Telegram webhook authentication fails closed", () => {
  withEnv("TELEGRAM_WEBHOOK_SECRET", undefined, () => {
    assertFalse(verifyTelegramWebhookRequest(new Request("https://edge.test")));
  });
});

Deno.test("Telegram webhook authentication accepts only the configured secret", () => {
  withEnv("TELEGRAM_WEBHOOK_SECRET", "configured-secret", () => {
    assert(
      verifyTelegramWebhookRequest(
        new Request("https://edge.test", {
          headers: { "X-Telegram-Bot-Api-Secret-Token": "configured-secret" },
        }),
      ),
    );
    assertFalse(
      verifyTelegramWebhookRequest(
        new Request("https://edge.test", {
          headers: { "X-Telegram-Bot-Api-Secret-Token": "wrong-secret" },
        }),
      ),
    );
  });
});
