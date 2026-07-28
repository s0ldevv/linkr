import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isFirstLaunchSubsidyEligible } from "./first_launch_subsidy.ts";

Deno.test("fund every eligible launch mode skips first-launch history checks", async () => {
  await withEnv("SOL_FUNDING_WALLET", "configured", async () => {
    const admin = mockAdmin({
      mode: "fund_every_eligible_launch",
      throwOnFrom: true,
    });
    assertEquals(
      await isFirstLaunchSubsidyEligible(admin, "user-1", {
        chain: "solana",
      }),
      true,
    );
  });
});

Deno.test("disabled launch funding mode is never eligible", async () => {
  await withEnv("SOL_FUNDING_WALLET", "configured", async () => {
    assertEquals(
      await isFirstLaunchSubsidyEligible(
        mockAdmin({ mode: "funding_disabled", throwOnFrom: true }),
        "user-1",
        { chain: "solana" },
      ),
      false,
    );
  });
});

Deno.test("first eligible launch mode is consumed by any prior first-launch funding event", async () => {
  await withEnv("SOL_FUNDING_WALLET", "configured", async () => {
    assertEquals(
      await isFirstLaunchSubsidyEligible(
        mockAdmin({
          mode: "first_eligible_launch",
          launchesCount: 0,
          fundingCount: 1,
        }),
        "user-1",
        { chain: "solana" },
      ),
      false,
    );
  });
});

Deno.test("first eligible launch mode requires a chain funding source", async () => {
  await withEnv("ETH_DEV_WALLET", null, async () => {
    assertEquals(
      await isFirstLaunchSubsidyEligible(
        mockAdmin({ mode: "first_eligible_launch", throwOnFrom: true }),
        "user-1",
        { chain: "robinhood" },
      ),
      false,
    );
  });
});

function mockAdmin(options: {
  mode: string;
  launchesCount?: number;
  fundingCount?: number;
  throwOnFrom?: boolean;
}) {
  return {
    rpc: async (name: string) => {
      if (name !== "get_linkr_admin_setting_v1") {
        throw new Error(`unexpected_rpc:${name}`);
      }
      return { data: { mode: options.mode }, error: null };
    },
    from(table: string) {
      if (options.throwOnFrom) throw new Error(`unexpected_table:${table}`);
      const query = {
        count: table === "coin_launches"
          ? options.launchesCount ?? 0
          : options.fundingCount ?? 0,
        error: null,
        select() {
          return query;
        },
        eq() {
          return query;
        },
        not() {
          return query;
        },
      };
      return query;
    },
  };
}

async function withEnv(
  name: string,
  value: string | null,
  fn: () => Promise<void>,
) {
  const previous = Deno.env.get(name);
  try {
    if (value == null) Deno.env.delete(name);
    else Deno.env.set(name, value);
    await fn();
  } finally {
    if (previous == null) Deno.env.delete(name);
    else Deno.env.set(name, previous);
  }
}
