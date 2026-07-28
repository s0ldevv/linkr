// deno-lint-ignore-file no-import-prefix
import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  verifyXPostingCredentials,
  XPostingVerificationError,
} from "./x_posting_verifier.ts";

const env = {
  X_OAUTH1_CONSUMER_KEY: "consumer",
  X_OAUTH1_CONSUMER_SECRET: "consumer-secret",
  X_OAUTH1_ACCESS_TOKEN: "access",
  X_OAUTH1_ACCESS_TOKEN_SECRET: "access-secret",
  X_BOT_USER_ID: "2070400325207334912",
  X_BOT_HANDLE: "linkrcash",
};

async function withEnv(run: () => Promise<void>) {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, Deno.env.get(key));
    Deno.env.set(key, value);
  }
  try {
    await run();
  } finally {
    for (const [key, value] of previous) {
      if (value == null) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}

Deno.test("X posting verifier accepts the exact configured identity", async () => {
  await withEnv(async () => {
    const result = await verifyXPostingCredentials((_input, init) => {
      const authorization = new Headers(init?.headers).get("Authorization") ??
        "";
      assertEquals(authorization.startsWith("OAuth "), true);
      return Promise.resolve(
        Response.json({
          data: { id: env.X_BOT_USER_ID, username: "LinkrCash" },
        }),
      );
    });
    assertEquals(result.xUserId, env.X_BOT_USER_ID);
    assertEquals(result.botHandle, "linkrcash");
  });
});

Deno.test("X posting verifier rejects a different X identity", async () => {
  await withEnv(async () => {
    await assertRejects(
      () =>
        verifyXPostingCredentials(() =>
          Promise.resolve(
            Response.json({ data: { id: "123", username: "wrong" } }),
          )
        ),
      XPostingVerificationError,
      "not the configured bot",
    );
  });
});

Deno.test("X posting verifier sanitizes X auth rejection", async () => {
  await withEnv(async () => {
    await assertRejects(
      () =>
        verifyXPostingCredentials(() =>
          Promise.resolve(
            Response.json({ title: "Unauthorized" }, { status: 401 }),
          )
        ),
      XPostingVerificationError,
      "X auth check 401",
    );
  });
});
