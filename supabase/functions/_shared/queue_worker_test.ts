import { buildContinuationBody } from "./queue_worker.ts";

Deno.test("versioned continuations retain the exact consumer version", () => {
  const body = buildContinuationBody(
    "command_prepare",
    17,
    "worker-command-prepare-v1",
  );
  if (body.consumer_version !== "worker-command-prepare-v1") {
    throw new Error("consumer version was dropped from continuation");
  }
  if (body.wake_generation !== 17 || body.stage !== "command_prepare") {
    throw new Error("continuation routing changed");
  }
});
