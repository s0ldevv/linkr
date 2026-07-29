# Production Asset 404 — Revised Root Cause & Fix Plan

**Date:** 2026-07-29 (revised 21:30 UTC, after Cloudflare removal)
**Symptom:** `https://www.linkr.cash/?_asset_retry=4&_asset_recovery_ts=…` renders "Linkr could not load the latest app", with console 404s for `useStore-BpNrsfCK.js`, `redirect-1Dss4sOM.js`, `useRouter-BYURwv8V.js`, `client-Bikll-K0.js`, `Match-CdEopgSe.js`, `link-_JQ8v5Qd.js`.
**Status:** **Executed 2026-07-29 22:00–23:00 UTC.** Production is stable on a single Vercel-built deployment. See §9 for exactly what was done, verified, and what remains.

---

## 1. Verdict, in one paragraph

Commit `0ff7005` has **two `READY` production deployments**. One was built by Vercel from git; the other was built **on this Windows machine** and pushed with `vercel deploy --prebuilt --prod`. A Windows-local Vite build and a Vercel Linux build of the same commit produce **different content hashes and a different chunk graph** — they can never match. The production alias currently points at the *locally built* one. Any request that gets answered by the sibling deployment 404s, because those filenames do not exist there at all.

The fix is one sentence: **production must have exactly one build, and that build must come from Vercel.** Everything else in this document is verification and blast-radius reduction.

---

## 2. Corrections to the previous revision

Two things it asserted are no longer (or never were) true. They mattered, because they sent the work in the wrong direction.

| Previous claim | Reality now |
|---|---|
| "Dependency drift between build environments is the cause (F2): local has `@tanstack/react-router` 1.170.18 vs Vercel's 1.170.16." | **False today.** The local tree now matches `package-lock.json` exactly — `react-router` 1.170.16, `react-start` 1.168.26, `router-core` 1.171.13 in both. The tree was reinstalled on Jul 28. Dependencies are *not* what makes the two builds differ. |
| "The browser received HTML from deployment A and asked deployment B for its filenames — the HTML was stale." | **Backwards.** The six filenames the user 404'd on are *exactly* the current live deployment's own `modulepreload` set, and all 32 of them return **200** right now. The browser had the **correct** HTML. The failure was on the **serving** side: those requests were answered by the sibling deployment. |

Why the two builds actually diverge, with dependencies identical:

1. **Different OS.** Local builds run on Windows, Vercel on Linux. Vite module IDs and chunk hashing are path-sensitive; cross-OS builds of one commit routinely produce wholesale different `/assets/*` names. This alone is sufficient and unfixable by pinning anything.
2. **Different inlined env.** `VITE_*` values are baked into the bundle at build time. Local `.env`/`.env.local` values need not equal Vercel's production values; different bytes ⇒ different hashes.
3. **Possibly stale generated route tree.** A local build can reuse `.tanstack/`'s generated route tree, which changes the module graph — this is the likely reason `Match-CdEopgSe.js` exists in the local build and has no counterpart in the Vercel build.

Consequence for the plan: **unifying lockfiles does not fix this.** It is hygiene, not the cure. The cure is to stop shipping locally built artifacts.

---

## 3. Evidence (all probed live, 21:29–21:32 UTC)

### 3.1 Two production deployments, one commit — the live one is the local build

```
dpl_4bbHdsMfqZmqF5JAvcSQLjxMAgqV  20:28:15  READY  production  source: cli   ← HOLDS THE ALIAS
    actor: claude-code_2-1-220_agent
    alias: www.linkr.cash, linkr.cash, linkr-new-devys-…vercel.app  (all 4)
dpl_GhQmnveM6sa3dTjQyqdoASU7Jbkz  20:26:13  READY  production  Vercel Git build
    alias: (branch alias only — no production domain)
```

Both are `isRollbackCandidate: true`. **A rollback or any alias re-resolution flips production to a build with a disjoint asset set.** This is the live hazard right now.

This is a repeating pattern, not a one-off — four duplicate-commit pairs in the last 20 production deployments, three of them flagged `gitDirty: 1` (built from an uncommitted tree, so that code exists nowhere in git):

| Commit | Git build | CLI build | Actor |
|---|---|---|---|
| `0ff7005` | `dpl_GhQmn…` | `dpl_4bbHds…` | `claude-code_2-1-220_agent` |
| `153686c` | `dpl_3rYQVcCq…` | `dpl_4V2zyHb8…` | `codex`, `gitDirty: 1` |
| `3f75f9f` | `dpl_HruP6dVg…` | `dpl_DW2oKurQ…` | `codex`, `gitDirty: 1` |
| `fbb0c83` | `dpl_8GMwvebH…` | `dpl_74FreqL6…` | `codex`, `gitDirty: 1` |

### 3.2 The reported 404s are the live deployment's own filenames

All 32 `/assets/*` references extracted from the live document — including every one the user reported — return `200`:

```
200  /assets/useStore-BpNrsfCK.js      200  /assets/client-Bikll-K0.js
200  /assets/redirect-1Dss4sOM.js      200  /assets/Match-CdEopgSe.js
200  /assets/useRouter-BYURwv8V.js     200  /assets/link-_JQ8v5Qd.js
…32/32 200
```

The browser was asking for the right files. Something answered from the wrong deployment. That is the whole bug.

### 3.3 Cloudflare is gone — confirmed, and it is no longer a factor

```
www.linkr.cash → cdf99f3376d4626a.vercel-dns-016.com → 216.150.1.65, 216.150.16.65
Server: Vercel     (no cf-mitigated, no cf-cache-status, no Cloudflare beacon)
```

The entire previous Phase 3 is **done**. One residue remains: `src/server.ts` still whitelists `https://static.cloudflareinsights.com` in `script-src`/`script-src-elem` — now a dead CSP entry to delete.

### 3.4 Cache headers are already correct — do not touch them

| Response | Headers |
|---|---|
| Document | `no-store, no-cache, must-revalidate, max-age=0` + `CDN-Cache-Control: no-store` ✅ |
| Real asset | `public, max-age=31536000, immutable`, `X-Vercel-Cache: HIT` ✅ |
| **Missing asset** | `404` + `no-store, no-cache, must-revalidate, max-age=0` ✅ |

The 404 path is safe: the pre-filesystem `immutable` header route for `/assets/(.*)` does **not** leak onto 404s, because `src/server.ts` re-sets document cache headers on the `text/html` 404. **There is no poisoned immutable-404 to chase.** Ruling this out is important — it is where several previous debugging cycles went.

### 3.5 Skew Protection works — the prebuilt deploys were silently stripping it

**This section originally concluded that Skew Protection was inert. That was wrong, and the correction matters.** The measurements behind it were all taken against the *locally built* deployment:

- Local `.vercel/output/config.json` has no skew-protection entry.
- The live document sent no `Set-Cookie`.

Both are true **only of a local build**. `VERCEL_SKEW_PROTECTION_ENABLED` exists only during a Vercel build, so a Windows `vite build` cannot emit the skew plumbing — the nitro preset silently omits it.

Verified after promoting the Vercel-built deployment:

- Project setting: `skewProtectionMaxAge: 43200` (12 hours) — **enabled**, with `autoExposeSystemEnvs: true`.
- The live document now issues `Set-Cookie: __vdpl=dpl_GhQmnveM6sa3dTjQyqdoASU7Jbkz; Path=/; SameSite=Strict; Secure; HttpOnly`.
- **Pinning proven end-to-end.** An asset present only in an older deployment (`/assets/index-BRFMuUrO.js`): `404` without the cookie, **`200`** with `__vdpl` set to that deployment.

So a tab open across a deploy is served its own chunks for 12 hours and never sees a 404. `nitro.vercel.skewProtection: true` in `vite.config.ts` is correct and **must stay**.

This makes the CLI deploys doubly destructive: they shipped a divergent build *and* removed the one mechanism that would have hidden the skew from users. It also explains why the outage was so visible rather than a brief blip.

The limit still holds: skew protection pins to a deployment **ID**, so it cannot arbitrate between two deployments that are both legitimately "production". It is not a substitute for §3.1.

### 3.6 The error screen is `asset-recovery.js` misdiagnosing itself

`public/asset-recovery.js` catches `vite:preloadError`, unregisters service workers, clears CacheStorage, and reloads with `_asset_retry` up to `MAX_ATTEMPTS = 4`, then renders the exact copy the user saw. Its premise — stale or blocked browser cache — is wrong for this failure (§3.4 rules caching out). Nothing it clears is implicated, so it burns four reloads and shows a dead end. **This is why the outage has been hard to see: the real cause is hidden behind a reload loop.**

### 3.7 Where the bad habit comes from

Nothing in the repo forbids CLI production deploys, and two things actively invite them:

- `ASSET_404_FIX_PLAN.md:178` literally instructs `vercel --prod --force`.
- `.vercel/output/nitro.json:15` advertises `"deploy": "npx vercel deploy --prebuilt"`.
- There is **no `CLAUDE.md` / `AGENTS.md`** in the repo, so no agent is constrained.

### 3.8 Minor, real, not the cause

- Apex `308`s to `www` for **assets** as well as documents, so any document served on the apex makes every chunk a cross-origin redirect hop.
- `public/sw.js` is a pure pass-through (`event.respondWith(fetch(event.request))`) — it caches nothing, so it is not the cause, but it adds a hop and serves no purpose.

---

## 4. The fix

Four steps. Steps 1 and 2 end the outage and its cause; steps 3 and 4 make recurrence impossible to miss.

### Step 1 — Collapse production to one build (minutes, no code change)

**Order matters — do not delete anything first, or the site goes down.**

1. **Promote the Git build** `dpl_GhQmnveM6sa3dTjQyqdoASU7Jbkz` to production (Vercel dashboard → Promote to Production, or `vercel promote dpl_GhQmnveM6sa3dTjQyqdoASU7Jbkz`). It is byte-reproducible from git; the CLI build is not.
2. **Verify convergence** before anything else: fetch the production document, extract every `/assets/*` reference, request each one, require all `200` (§6 has the one-liner).
3. **Delete the CLI sibling** `dpl_4bbHdsMfqZmqF5JAvcSQLjxMAgqV`, plus the CLI duplicates for `153686c`, `3f75f9f`, `fbb0c83`. This is the point of the step: while they exist, a rollback can reintroduce a divergent build.
4. Do not deploy again until Step 2 lands.

**Expected one-time cost:** tabs currently holding CLI-build HTML will 404 once on promotion. Because documents are `no-store`, a single reload fixes them. This is unavoidable and is exactly what Step 3 makes graceful.

> Do **not** ask users to clear caches. §3.4 proves their browsers are innocent.

*Alternative if you would rather not hand-promote:* push any commit to `main` and let the Git integration build and alias it. That also yields a single Vercel-built production deployment, but leaves the four duplicate pairs as rollback candidates — so still do 1.3.

### Step 2 — Make a locally built production deploy impossible (the root fix)

Vercel has no first-class "block CLI production deploys" switch, so enforcement is layered. Items 1–3 are the ones that actually bind.

1. **Delete the instructions that cause it.** Remove the `vercel --prod --force` line from `ASSET_404_FIX_PLAN.md` (or delete that superseded file outright). Never document a production CLI deploy again.
2. **Add `CLAUDE.md` at the repo root** with a hard rule, since no agent-facing constraint exists today:
   > Production deploys happen **only** by pushing to `main`. Never run `vercel --prod`, `vercel deploy --prod`, or `vercel deploy --prebuilt`. `.vercel/output` is local scratch and must never be deployed. Previews (`vercel deploy`, no `--prod`) are fine.
3. **Add the duplicate-production guard to CI/`npm run check`** (Step 4.2). This is the only mechanism that *catches* a violation rather than merely asking for compliance — treat it as the real enforcement.
4. **Rotate the Vercel token agents currently hold** so the one that produced `claude-code_2-1-220_agent` and `codex` deploys no longer works, and keep production promotion to a human-held credential.
5. **Confirm `main` is the production branch** in Project Settings → Git.
6. Optional hygiene, now that it is not the root cause: delete `bun.lock` and `deno.lock` (keep only `package-lock.json`), remove the `node_modules/.deno` tree, add `"packageManager"` and `engines.node: 24.x` to `package.json`, and set Vercel's Install Command to `npm ci`. Do this **separately** from the outage fix so it cannot confuse verification.

### Step 3 — Make the unavoidable deploy window non-fatal

Even with one pipeline, a tab open across a deploy holds HTML whose chunks no longer exist. That must degrade in one reload, not into a dead end.

1. **Rewrite `public/asset-recovery.js` to be honest and minimal.** On `vite:preloadError` or a chunk load error:
   - Reload the document **once**. Documents are `no-store`, so one reload always fetches HTML with correct hashes — which genuinely resolves single-pipeline skew.
   - Guard with a short-lived marker so it cannot loop. On a second consecutive failure show an accurate message — "Linkr just updated — reloading" with a manual retry — not "your browser has an old file".
   - **Drop the service-worker and CacheStorage teardown.** It targets a cause that is ruled out (§3.4) and it hides the real failure.
   - **Drop the `_asset_retry` / `_asset_recovery_ts` URL params.** They pollute URLs and analytics and fix nothing.
   - **Report the failure** (below) instead of silently retrying four times.
2. **Report chunk-load failures.** POST a compact record — document URL, failed asset, `X-Vercel-Id`, deployment ID, timestamp — to an endpoint alongside the existing `/api/csp-report` handler in `src/server.ts`. Silent client-side reloads are why this ran undiagnosed for days.
3. **Decide on Skew Protection deliberately.** Either enable it at the platform — `vercel project protection enable --skew --skew-max-age 2592000` — and then *prove* it works (production document must set a `__vdpl` cookie); or, if TanStack Start/Nitro will not emit the client-side deployment ID, **remove the misleading `skewProtection: true` flag** from `vite.config.ts` and rely on 3.1. Do not leave it configured-but-inert, which is today's state.
4. **Leave all cache headers exactly as they are.** They are correct (§3.4).

### Step 4 — A verification gate, so this can never be invisible again

This failure is detectable in about five seconds. That it wasn't is the biggest process gap.

1. **`scripts/verify-production-assets.mjs`** — fetch the production document, extract every `/assets/*.js|css` and `modulepreload` href, request each, assert `200` with a JS/CSS content type, assert the document carries `no-store` and assets carry `immutable`, exit non-zero listing any offender.
2. **`scripts/verify-single-production.mjs`** — query Vercel for deployments at `target: production` and **fail if more than one is `READY` for the current commit SHA**. This is the guard that catches a Step-2 violation.
3. Run both after every production deploy and add them to `npm run check`.

---

## 5. Cleanups (small, safe, do after the outage is closed)

| Item | Action |
|---|---|
| Dead Cloudflare CSP entry | Remove `https://static.cloudflareinsights.com` from `script-src` and `script-src-elem` in `src/server.ts` |
| Pointless service worker | Delete `public/sw.js` and its registration, or make it a no-op that unregisters itself |
| Apex asset hop (§3.8) | Keep `www` canonical; ensure no document is ever served on the apex, so no asset takes the cross-origin 308 |
| Superseded plans | Delete `ASSET_404_FIX_PLAN.md` (its §178 is actively harmful) |
| Auth allowlists | Re-test X sign-in, wallet export, and CLI login after any host/redirect change — commit `0ff7005` touched exactly these |

---

## 6. Verification matrix

Run after Step 1, and again after Steps 2–3. Every row must pass.

| # | Check | Method | Pass |
|---|---|---|---|
| V1 | **One** production deployment for `HEAD` | `scripts/verify-single-production.mjs` | Exactly one `READY` |
| V2 | Production deployment's `source` is not `cli` | deployment metadata | Vercel Git build |
| V3 | Every referenced asset resolves | `scripts/verify-production-assets.mjs` | 32/32 `200`, correct content type |
| V4 | Document is the app | headless navigation to `https://www.linkr.cash/` | `200`, real title, no fallback screen |
| V5 | Cache headers unchanged | response headers | doc `no-store`; assets `immutable` |
| V6 | Missing asset stays uncacheable | request `/assets/nope-AAAA.js` | `404` + `no-store` |
| V7 | No duplicate rollback candidates | deployments list | No divergent `READY` production siblings |
| V8 | Skew handled in one reload | open a tab, deploy, navigate | One automatic reload recovers; no dead end |
| V9 | Skew Protection is on **or** the flag is gone | `curl -I` for `__vdpl`; grep `vite.config.ts` | Cookie present, or flag removed |

The check that would have caught this instantly:

```bash
curl -sS -o live.html https://www.linkr.cash/
grep -aoE '/assets/[A-Za-z0-9._$-]+\.(js|css)' live.html | sort -u |
  while read -r a; do
    printf '%s  %s\n' "$(curl -sS -o /dev/null -w '%{http_code}' "https://www.linkr.cash$a")" "$a"
  done | grep -v '^200' || echo "ALL ASSETS OK"
```

---

## 7. Sequencing and risk

**Order:** Step 1 → Step 4 → Step 2 → Step 3 → §5 cleanups.
Land the verifier (Step 4) before the behavioural changes, so everything after it is proven rather than assumed.

| Change | Risk | Mitigation |
|---|---|---|
| Promote the Git build (S1) | Open tabs 404 once | Documents are `no-store`; one reload fixes. Alias moves are instantly reversible |
| Delete CLI deployments (S1.3) | Loses those as rollback targets — **intended** | Only after V3 passes on the promoted build |
| Rotate agent token (S2.4) | Agents lose a shortcut | Intentional; previews still work |
| Rewrite `asset-recovery.js` (S3.1) | Behaviour change on the failure path | Ship after S1; V8 covers it |
| Lockfile unification (S2.6) | Dependency versions shift for bun/deno users | Land alone, verify V3 + full `npm run check`; one-commit revert |

**Explicitly deferred — these are ruled out, and pursuing them is what kept this loop alive:** cache-header tuning (§3.4), service-worker theories (§3.8), poisoned immutable 404s (§3.4), dependency pinning as a *cure* (§2), and asking users to clear caches.

---

## 9. Execution record — 2026-07-29

### Done and verified live

| Step | Action | Verification |
|---|---|---|
| 1.1 | Verified the Git build `dpl_GhQmn…` before touching production: real app title, **31/31** of its own assets `200` | Probed via share token while it was still unaliased |
| 1.1 | Quantified the divergence: **24 CLI-only, 23 Git-only, only 8 shared** of ~32 assets | `comm` on both asset sets |
| 1.2 | `vercel promote dpl_GhQmnveM6sa3dTjQyqdoASU7Jbkz` | Live asset set now equals the Git build's exactly |
| 1.2 | Confirmed no alias flapping | 8 consecutive requests, all `200`; CLI-only filenames now `404` |
| 1.3 | Deleted all four CLI deployments (`dpl_4bbHds`, `dpl_4V2zyHb8`, `dpl_DW2oKurQ`, `dpl_74FreqL6`) — oldest three first, live re-verified between batches | 40 production deployments remain, **all** Git-built, no duplicate commits, no `gitDirty` |
| 2.1 | Deleted `ASSET_404_FIX_PLAN.md`, which instructed `vercel --prod --force` as "Option A (recommended)" — the origin of the outage | File was untracked and never committed |
| 2.2 | Added `CLAUDE.md` with the hard deploy rule and the reason | — |
| 2.5 | Confirmed `productionBranch: main`, repo `s0ldevv/linkr` | Vercel project API |
| 3.1 | Rewrote `public/asset-recovery.js`: one reload, honest copy, no cache/SW teardown, no URL params | Syntax-checked; present in build output |
| 3.2 | Added `/api/asset-failure` reporting endpoint | Exercised against the **built** bundle: `204` valid, `405` GET, `413` oversized, `204` malformed; CRLF injection rejected, query tokens stripped, hostile schemes nulled |
| 3.3 | Resolved: Skew Protection is enabled and **proven working** (§3.5). Flag kept. | `__vdpl` cookie issued; pinning test passed |
| 4 | Added both verifier scripts and `npm run verify:production` | Both pass live; detection logic proven to fire on the recorded bad shapes |
| §5 | Removed the dead Cloudflare CSP origin; stopped `sw.js` proxying every request | `0` occurrences in built server bundle; built `sw.js` has no `respondWith` |

### Deliberate deviations from the plan

1. **`sw.js` was not deleted.** The plan said to delete it, but `MobileInstallBanner.tsx` registers it for PWA installability, so deleting it would regress "Add to Home Screen". Instead the `fetch` listener is now empty and never calls `respondWith`, so nothing is proxied while the handler still exists for install heuristics.
2. **The verifiers were not added to `npm run check`.** `check` is a local pre-push gate; adding a live-production HTTP probe would make it fail whenever production is mid-deploy, which trains people to ignore it. They live in `npm run verify:production` instead, documented in `CLAUDE.md` as a post-deploy step.
3. **Lockfile unification (2.6) was not done.** §2 establishes it is not the root cause. It is hygiene, and doing it during an outage fix would have muddied verification.

### Not done — needs the account owner

- **Token rotation (2.4).** The Vercel token that produced the `claude-code_2-1-220_agent` and `codex` deploys is still valid. Until it is rotated, the deploy rule rests on `CLAUDE.md` plus the integrity guard catching a violation after the fact. This is the only remaining hard block.
- **Pre-existing, unrelated:** `npm run audit:architecture` fails identically before and after these changes (local `.env`/`.env.local` present, and two `verify_jwt=false` edge functions without a recognized auth gate).

## 8. Decisions needed before execution

1. **Step 1 route:** hand-promote `dpl_GhQmn…` (faster, recommended), or push a fresh commit to `main`?
2. **Token rotation (S2.4):** rotate the agent-held Vercel token now, or rely on `CLAUDE.md` + the duplicate guard alone? Rotation is the only hard block.
3. **Skew Protection (S3.3):** enable it at the platform and verify `__vdpl`, or remove the inert flag and rely on one-reload recovery? Either is defensible; the current middle state is not.
4. **Lockfiles (S2.6):** confirm npm as the single package manager — it is what Vercel already uses — and that no workflow still needs `bun.lock` or `deno.lock` outside `supabase/`.
