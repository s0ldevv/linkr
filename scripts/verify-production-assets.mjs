// Verifies that every /assets/* file the production document references actually
// resolves. This is the check that catches deployment skew — an HTML document
// referencing chunk filenames that the serving deployment does not contain.
//
// Usage: node scripts/verify-production-assets.mjs [origin]
//   origin defaults to $LINKR_PRODUCTION_ORIGIN or https://www.linkr.cash

const origin = (
  process.argv[2] ??
  process.env.LINKR_PRODUCTION_ORIGIN ??
  "https://www.linkr.cash"
).replace(/\/$/, "");

const failures = [];
const notes = [];
// Declared up front so report() is safe to call from any early-exit path.
let assets = [];
let okCount = 0;

const documentResponse = await fetch(`${origin}/`, {
  redirect: "follow",
  headers: { accept: "text/html", "sec-fetch-dest": "document" },
});

if (!documentResponse.ok) {
  fail(`document ${origin}/ returned ${documentResponse.status}`);
  report();
}

const html = await documentResponse.text();

// The document must never be cached, or a browser can hold HTML whose chunks
// have already been replaced by a newer deployment.
const documentCacheControl = documentResponse.headers.get("cache-control") ?? "";
if (!documentCacheControl.includes("no-store")) {
  fail(`document cache-control is "${documentCacheControl}" (expected no-store)`);
}

// A Cloudflare-style interstitial or an error page would also return 200.
const title = html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() ?? "";
if (!/linkr/i.test(title)) {
  fail(`document title is "${title}" — this does not look like the app`);
}
if (/Just a moment|Checking your browser|Attention Required/i.test(html)) {
  fail("document body looks like a CDN/WAF challenge page, not the app");
}

assets = [...new Set(html.match(/\/assets\/[A-Za-z0-9._$-]+\.(?:js|css)/g) ?? [])].sort();
if (assets.length === 0) {
  fail("document references no /assets/* files at all — the build output looks wrong");
  report();
}

const results = await Promise.all(assets.map(check));
okCount = results.filter(Boolean).length;

// A missing asset must not be cacheable, or one 404 gets pinned at the edge and
// in browsers for the lifetime of the immutable TTL.
const bogus = `/assets/verify-missing-${Date.now()}.js`;
const bogusResponse = await fetch(`${origin}${bogus}`, { redirect: "manual" });
if (bogusResponse.status !== 404) {
  notes.push(`expected 404 for ${bogus}, got ${bogusResponse.status}`);
}
const bogusCacheControl = bogusResponse.headers.get("cache-control") ?? "";
if (!bogusCacheControl.includes("no-store")) {
  fail(`a missing asset is cacheable: cache-control "${bogusCacheControl}" (expected no-store)`);
}

report();

async function check(path) {
  let response;
  try {
    response = await fetch(`${origin}${path}`, { redirect: "manual" });
  } catch (error) {
    fail(`${path} — request failed: ${error.message}`);
    return false;
  }

  if (response.status !== 200) {
    fail(`${path} — HTTP ${response.status} (referenced by the live document)`);
    return false;
  }

  const contentType = response.headers.get("content-type") ?? "";
  const expected = path.endsWith(".css") ? "css" : "javascript";
  if (!contentType.includes(expected)) {
    fail(`${path} — content-type "${contentType}" (expected ${expected})`);
    return false;
  }

  const cacheControl = response.headers.get("cache-control") ?? "";
  if (!cacheControl.includes("immutable")) {
    notes.push(`${path} — cache-control "${cacheControl}" (expected immutable)`);
  }
  return true;
}

function fail(message) {
  failures.push(message);
}

function report() {
  for (const note of notes) console.warn(`  warning: ${note}`);

  if (failures.length) {
    console.error(`Production asset verification FAILED for ${origin}`);
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error(
      "\nAsset 404s on a live document mean production is serving a different build " +
        "than the one that rendered the HTML. Check for more than one production " +
        "deployment: node scripts/verify-single-production.mjs",
    );
    process.exit(1);
  }

  console.log(
    `Production assets verified on ${origin} ` +
      `(${okCount}/${assets.length} assets 200, document no-store, missing assets uncacheable).`,
  );
}
