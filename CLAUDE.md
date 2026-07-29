# Linkr — agent and contributor rules

## Deployment: GitHub is the only source of production

**Production deploys happen only by pushing to `main`.** Vercel's Git integration
builds it. That is the entire deploy process.

Never run any of these:

```
vercel --prod
vercel deploy --prod
vercel deploy --prebuilt
vercel --prod --force
```

`.vercel/output` is local build scratch. It must never be deployed.

**Why this is a hard rule, not a preference.** On 2026-07-29 production served the
fallback screen "Linkr could not load the latest app" with 404s on six chunks. The
cause: commit `0ff7005` had two production deployments — one built by Vercel from
git, one built on a Windows dev machine and pushed with `vercel deploy --prebuilt
--prod`. A local Windows build and Vercel's Linux build of the same commit produce
**different Vite content hashes and a different chunk graph** — measured at the time,
only 8 of 32 asset filenames matched. Whichever deployment answered a request that
the other's HTML had referenced returned a hard 404 on every chunk. Three earlier CLI
deploys were also flagged `gitDirty`, meaning production ran code that existed
nowhere in git.

Aligning dependencies does not fix this. Cross-OS builds cannot be made
byte-identical. The only fix is that exactly one build — Vercel's — reaches
production.

Previews are fine and encouraged: `vercel deploy` with no `--prod`.

### After every production deploy

```bash
VERCEL_TOKEN=… npm run verify:production
```

- `scripts/verify-single-production.mjs` — fails if any production deployment was
  not built by Vercel from git, or if one commit has more than one READY production
  deployment. This is the guard that catches a violation of the rule above.
- `scripts/verify-production-assets.mjs` — fetches the live document and requests
  every `/assets/*` file it references. Asset 404s here mean production is serving a
  different build than the one that rendered the HTML.

Both are read-only and safe to run any time.

### If users report "could not load the latest app" / chunk 404s

1. Run `npm run verify:production`. It diagnoses this failure directly.
2. If the integrity guard fails, remove the offending deployment and promote the Git
   build: `vercel promote <git-built-deployment-id>`.
3. **Never tell users to clear their cache.** Documents are served `no-store` and
   missing assets return `404` with `no-store`, both verified. A chunk 404 is a
   server-side deployment problem every time; browser caches are not involved.

## Cache headers — do not change these

They are correct and load-bearing:

| Response | Header |
|---|---|
| SSR documents | `no-store, no-cache, must-revalidate, max-age=0` + `CDN-Cache-Control: no-store` |
| `/assets/*` | `public, max-age=31536000, immutable` |
| Missing `/assets/*` | `404` + `no-store` (must never become cacheable) |

Documents must stay `no-store` so a single reload always fetches HTML with current
chunk hashes. That property is what makes deploy-time skew recoverable.

## Asset load failure handling

`public/asset-recovery.js` reloads the document **once** on a chunk load error, then
shows an honest message. Do not reintroduce a multi-attempt reload loop, and do not
clear service workers or CacheStorage on the failure path — caching is not what
causes chunk 404s, and clearing it hides the real cause.

## Infrastructure notes

- **DNS goes straight to Vercel.** Cloudflare was removed on 2026-07-29 after its
  managed challenge began returning `403 cf-mitigated: challenge` on `/assets/*.js`.
  Do not put a second CDN or WAF in front of Vercel.
- `www.linkr.cash` is canonical; the apex 308-redirects to it at Vercel.
- Server-side origin allowlists must accept **both** the apex and `www` spellings —
  auth handoff codes break otherwise (see commit `0ff7005`).
