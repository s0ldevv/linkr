// Guards the one invariant that broke production: there must be exactly ONE
// production deployment, and it must have been built by Vercel from git.
//
// A second production deployment of the same commit — typically a locally built
// `vercel deploy --prebuilt --prod` — has different Vite content hashes, because
// a Windows/local build and Vercel's Linux build never produce the same chunk
// filenames. Requests answered by the wrong one 404 on every chunk.
//
// Usage: node scripts/verify-single-production.mjs
// Requires VERCEL_TOKEN. Project/team come from env or .vercel/project.json.

import fs from "node:fs";

const token = process.env.VERCEL_TOKEN;
if (!token) {
  console.warn(
    "verify-single-production: skipped (no VERCEL_TOKEN). " +
      "Run this with a token after every production deploy — it is the guard that " +
      "catches a locally built production deployment.",
  );
  process.exit(0);
}

const linked = readLinkedProject();
const projectId = process.env.VERCEL_PROJECT_ID ?? linked.projectId;
const teamId = process.env.VERCEL_ORG_ID ?? linked.orgId;

if (!projectId || !teamId) {
  console.error(
    "verify-single-production: no project. Set VERCEL_PROJECT_ID and VERCEL_ORG_ID, " +
      "or run `vercel link` so .vercel/project.json exists.",
  );
  process.exit(1);
}

const query = new URLSearchParams({ projectId, teamId, target: "production", limit: "40" });
const response = await fetch(`https://api.vercel.com/v6/deployments?${query}`, {
  headers: { Authorization: `Bearer ${token}` },
});

if (!response.ok) {
  console.error(`verify-single-production: Vercel API returned ${response.status}`);
  process.exit(1);
}

const { deployments = [] } = await response.json();
const ready = deployments.filter((d) => d.state === "READY" || d.readyState === "READY");
const failures = [];

// Any production deployment built anywhere other than Vercel's Git integration.
// The Git integration always stamps githubRepoOwnerType + a branch alias; CLI
// deploys carry an `actor` instead, and `gitDirty` when the tree was uncommitted.
const cliBuilt = ready.filter((d) => d.source === "cli" || d.meta?.actor || d.meta?.gitDirty);
for (const d of cliBuilt) {
  failures.push(
    `${d.uid ?? d.id} (${short(d.meta?.githubCommitSha)}) was not built by Vercel from git` +
      `${d.meta?.actor ? ` — actor: ${d.meta.actor}` : ""}` +
      `${d.meta?.gitDirty ? " — built from an UNCOMMITTED tree" : ""}`,
  );
}

// More than one READY production deployment for a single commit is the exact
// condition that makes the production alias ambiguous.
const byCommit = new Map();
for (const d of ready) {
  const sha = d.meta?.githubCommitSha ?? "unknown";
  byCommit.set(sha, [...(byCommit.get(sha) ?? []), d]);
}
for (const [sha, group] of byCommit) {
  if (group.length > 1) {
    failures.push(
      `commit ${short(sha)} has ${group.length} READY production deployments: ` +
        group.map((d) => d.uid ?? d.id).join(", "),
    );
  }
}

if (failures.length) {
  console.error("Production deployment integrity FAILED:");
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error(
    "\nProduction must be built only by Vercel from a push to main. " +
      "Never run `vercel --prod`, `vercel deploy --prod`, or `vercel deploy --prebuilt`. " +
      "Remove the offending deployment, then promote the Git build.",
  );
  process.exit(1);
}

console.log(
  `Production deployment integrity verified ` +
    `(${ready.length} READY production deployments, all built by Vercel from git, ` +
    `no duplicate commits).`,
);

function short(sha) {
  return typeof sha === "string" && sha.length > 7 ? sha.slice(0, 7) : (sha ?? "unknown");
}

function readLinkedProject() {
  try {
    return JSON.parse(fs.readFileSync(".vercel/project.json", "utf8"));
  } catch {
    return {};
  }
}
