import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { linkrUrlHostVariants } from "./app_origins.ts";
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

Deno.test("sensitive CORS reflects exact canonical origins only", () => {
  withEnv("LINKR_BROWSER_ORIGINS", "https://preview.example", () => {
    const allowed = sensitiveCorsHeaders(
      new Request("https://edge.test", {
        headers: { Origin: "https://linkr.cash" },
      }),
    );
    assertEquals(
      allowed["Access-Control-Allow-Origin"],
      "https://linkr.cash",
    );
    assertEquals(allowed.Vary, "Origin");

    const legacy = sensitiveCorsHeaders(
      new Request("https://edge.test", {
        headers: { Origin: "https://preview.example" },
      }),
    );
    assertFalse("Access-Control-Allow-Origin" in legacy);
  });
});

Deno.test("sensitive CORS allows both linkr.cash host spellings", () => {
  withEnv("LINKR_BROWSER_ORIGINS", undefined, () => {
    for (const origin of ["https://linkr.cash", "https://www.linkr.cash"]) {
      const headers = sensitiveCorsHeaders(
        new Request("https://edge.test", { headers: { Origin: origin } }),
      );
      assertEquals(headers["Access-Control-Allow-Origin"], origin);
    }

    // A lookalike host must not inherit the apex/www allowance.
    for (
      const origin of [
        "https://linkr.cash.evil.example",
        "https://wwwlinkr.cash",
        "http://linkr.cash",
      ]
    ) {
      const headers = sensitiveCorsHeaders(
        new Request("https://edge.test", { headers: { Origin: origin } }),
      );
      assertFalse("Access-Control-Allow-Origin" in headers);
    }
  });
});

Deno.test("linkr URL host variants cover apex and www only", () => {
  const variants = linkrUrlHostVariants(
    "https://www.linkr.cash/auth/callback?auth_popup=1&auth_flow=abc",
  );
  assertEquals(variants.length, 2);
  assert(
    variants.includes(
      "https://www.linkr.cash/auth/callback?auth_popup=1&auth_flow=abc",
    ),
  );
  assert(
    variants.includes(
      "https://linkr.cash/auth/callback?auth_popup=1&auth_flow=abc",
    ),
  );

  // Untrusted hosts are never expanded, so a code stays bound to one URL.
  assertEquals(linkrUrlHostVariants("https://evil.example/auth/callback"), [
    "https://evil.example/auth/callback",
  ]);
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
