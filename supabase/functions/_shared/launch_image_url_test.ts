import { resolvePublicLaunchImageUrl } from "./launch_image_url.ts";

function assertEquals(actual: unknown, expected: unknown) {
  if (actual !== expected) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

Deno.test("public launch images prefer the app-owned token-logo object", () => {
  assertEquals(
    resolvePublicLaunchImageUrl(
      {
        imageUrl: "https://ipfs.filebase.io/ipfs/QmImage",
        stableLogoUrl: "https://ipfs.filebase.io/ipfs/QmStable",
        tokenLogoStoragePath: "my coin/launch.jpg",
      },
      "https://project.supabase.co/",
    ),
    "https://project.supabase.co/storage/v1/object/public/token-logos/my%20coin/launch.jpg",
  );
});

Deno.test("public launch images fall back only to valid HTTPS URLs", () => {
  assertEquals(
    resolvePublicLaunchImageUrl(
      {
        stableLogoUrl: "ipfs://QmStable",
        imageUrl: "javascript:alert(1)",
        originalImageUrl: "https://images.example/token.png",
      },
      null,
    ),
    "https://images.example/token.png",
  );
});

Deno.test("public launch images reject unsafe storage paths", () => {
  assertEquals(
    resolvePublicLaunchImageUrl(
      {
        tokenLogoStoragePath: "../secret.png",
        imageUrl: "https://images.example/fallback.png",
      },
      "https://project.supabase.co",
    ),
    "https://images.example/fallback.png",
  );
});
