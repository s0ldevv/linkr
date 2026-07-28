import {
  jsonRpc,
  providerFetch,
  readProviderEndpoints,
  sanitizedEndpointIdentity,
} from "./provider_pool.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("provider configuration is ordered and secret URL data is sanitized", () => {
  const name = "LINKR_PROVIDER_POOL_TEST";
  Deno.env.set(
    name,
    JSON.stringify([
      {
        label: "backup",
        url: "https://backup.example/rpc?key=secret",
        priority: 10,
      },
      {
        label: "primary",
        url: "https://primary.example/private/secret",
        priority: 100,
        timeout_ms: 9000,
      },
    ]),
  );
  try {
    const endpoints = readProviderEndpoints(name);
    assert(endpoints[0].label === "primary", "priority ordering failed");
    assert(
      sanitizedEndpointIdentity(endpoints[0]) === "https://primary.example",
      "endpoint leaked path",
    );
  } finally {
    Deno.env.delete(name);
  }
});

Deno.test("provider fallback preserves current single URL during rollout", () => {
  const endpoints = readProviderEndpoints(
    "LINKR_PROVIDER_POOL_MISSING_TEST",
    "https://legacy.example/rpc",
  );
  assert(
    endpoints.length === 1 && endpoints[0].label === "legacy-primary",
    "fallback missing",
  );
});

Deno.test("provider fetch fails over on retryable HTTP without changing the request", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: string }> = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: String(init?.body ?? "") });
    return Promise.resolve(
      url.includes("primary")
        ? new Response("busy", { status: 503 })
        : new Response("ok", { status: 200 }),
    );
  }) as typeof fetch;
  try {
    const endpoints = [
      {
        label: "primary",
        url: "https://primary.example",
        priority: 100,
        timeout_ms: 1000,
      },
      {
        label: "backup",
        url: "https://backup.example",
        priority: 50,
        timeout_ms: 1000,
      },
    ];
    const result = await providerFetch(endpoints, {
      method: "POST",
      body: "same-bytes",
    });
    assert(result.endpoint.label === "backup", "backup was not selected");
    assert(calls.length === 2, "unexpected provider call count");
    assert(
      calls.every((call) => call.body === "same-bytes"),
      "request bytes changed",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("deterministic JSON-RPC errors are not replayed to another provider", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (() => {
    calls++;
    return Promise.resolve(
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "test",
          error: { code: -32000, message: "deterministic" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  }) as typeof fetch;
  try {
    let rejected = false;
    try {
      await jsonRpc(
        [
          {
            label: "one",
            url: "https://one.example",
            priority: 100,
            timeout_ms: 1000,
          },
          {
            label: "two",
            url: "https://two.example",
            priority: 50,
            timeout_ms: 1000,
          },
        ],
        "eth_call",
        [],
      );
    } catch (error) {
      rejected = error instanceof Error &&
        error.message === "json_rpc_error_-32000";
    }
    assert(rejected, "deterministic JSON-RPC error was not preserved");
    assert(calls === 1, "deterministic error was incorrectly replayed");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
