import {
  rpcCall,
  verifyRobinhoodLaunchReceipt,
} from "./chain_confirmation.ts";

Deno.test("chain confirmation rejects non-HTTPS provider URLs", async () => {
  let rejected = false;
  try {
    await rpcCall("http://example.com", "test", []);
  } catch (error) {
    rejected = String(error).includes("chain_rpc_url_rejected");
  }
  if (!rejected) throw new Error("insecure provider URL was accepted");
});

Deno.test("Robinhood launch receipt proves factory, token, creator, and pool", () => {
  const factory = "0x1111111111111111111111111111111111111111";
  const token = "0x2222222222222222222222222222222222222222";
  const creator = "0x3333333333333333333333333333333333333333";
  const pool = "0x4444444444444444444444444444444444444444";
  const topic = (address: string) =>
    `0x${address.slice(2).padStart(64, "0")}`;
  const event = verifyRobinhoodLaunchReceipt({
    status: "0x1",
    logs: [{
      address: factory.toUpperCase().replace("0X", "0x"),
      topics: [
        "0x5cd09150c40d7c6bc0e837fe9b4ce8aacf8aa2a9af5ed0e80341ef8535b7c10d",
        topic(token),
        topic(creator),
        topic(pool),
      ],
    }],
  }, { factory, token, creator });
  if (
    event.factory !== factory || event.token !== token ||
    event.creator !== creator || event.pool !== pool
  ) throw new Error("launch event was not decoded exactly");
});

Deno.test("Robinhood launch receipt rejects a different predicted token", () => {
  let rejected = false;
  try {
    verifyRobinhoodLaunchReceipt({
      logs: [{
        address: "0x1111111111111111111111111111111111111111",
        topics: [
          "0x5cd09150c40d7c6bc0e837fe9b4ce8aacf8aa2a9af5ed0e80341ef8535b7c10d",
          `0x${"22".repeat(32)}`,
          `0x${"00".repeat(12)}${"33".repeat(20)}`,
          `0x${"00".repeat(12)}${"44".repeat(20)}`,
        ],
      }],
    }, {
      factory: "0x1111111111111111111111111111111111111111",
      token: "0x5555555555555555555555555555555555555555",
    });
  } catch (error) {
    rejected = String(error).includes(
      "robinhood_launch_event_missing_or_mismatched",
    );
  }
  if (!rejected) throw new Error("mismatched launch event was accepted");
});
