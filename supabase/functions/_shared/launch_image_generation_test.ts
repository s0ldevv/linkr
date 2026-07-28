import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { capturedImageFromBytes } from "./bounded_media.ts";
import { deterministicFallbackPng } from "./launch_image_generation.ts";

Deno.test("deterministic fallback is stable, bounded, and valid PNG", async () => {
  const first = await deterministicFallbackPng("draft-1");
  const second = await deterministicFallbackPng("draft-1");
  assertEquals(first, second);
  const image = await capturedImageFromBytes(
    first,
    "image/png",
    "generated:test",
  );
  assertEquals(image.width, 256);
  assertEquals(image.height, 256);
  assertEquals(image.bytes.byteLength < 1024 * 1024, true);
});
