import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
const warnings = [];
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));

function fail(message) {
  failures.push(message);
}

for (const file of [
  ".env",
  ".env.local",
  "supabase/.env.local",
  ".linkr_internal_secret.tmp",
]) {
  if (exists(file)) fail(`secret-bearing file must not be packaged: ${file}`);
}

for (const required of [
  ".env.example",
  ".env.local.example",
  "supabase/.env.example",
  "supabase/migrations/20260727190000_world_class_runtime_hardening.sql",
]) {
  if (!exists(required)) fail(`required hardening artifact is missing: ${required}`);
}

const requiredEnvironmentMarkers = {
  ".env.example": [
    "VITE_SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY",
    "LINKR_GATEWAY_STREAM_IDLE_TIMEOUT_MS",
  ],
  "supabase/.env.example": [
    "LINKR_INTERNAL_KEY",
    "WALLET_ENCRYPTION_SECRET",
    "AGENT_API_KEY_PEPPER_V2",
    "COMET_API_KEY",
    "COMET_STREAM_TIMEOUT_MS",
    "LINKR_ACTION_EXECUTOR_TIMEOUT_MS",
    "TELEGRAM_BOT_TOKEN",
    "X_CLIENT_ID",
    "SOLANA_RPC_URL",
    "ROBINHOOD_RPC_URL",
    "FILEBASE_S3_SECRET_ACCESS_KEY",
  ],
};
for (const [file, markers] of Object.entries(requiredEnvironmentMarkers)) {
  const source = read(file);
  for (const marker of markers) {
    if (!source.includes(`${marker}=`)) {
      fail(`environment template ${file} is missing ${marker}`);
    }
  }
}

const edgeRoot = path.join(root, "supabase/functions");
const functionDirs = fs
  .readdirSync(edgeRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
  .map((entry) => entry.name)
  .sort();
const config = read("supabase/config.toml");
for (const name of functionDirs) {
  const dir = path.join(edgeRoot, name);
  const files = fs.readdirSync(dir);
  if (files.length === 0) {
    fail(`empty edge function directory: ${name}`);
    continue;
  }
  if (!files.includes("index.ts")) fail(`edge function has no index.ts: ${name}`);
  if (!config.includes(`[functions.${name}]`)) {
    fail(`edge function is not declared in supabase/config.toml: ${name}`);
  }
}

const tsFiles = walk(edgeRoot).filter((file) => file.endsWith(".ts"));
for (const file of tsFiles) {
  const source = fs.readFileSync(file, "utf8");
  const relative = path.relative(root, file).replaceAll(path.sep, "/");
  if (/\breq\.json\s*\(/.test(source)) {
    fail(`unbounded request JSON parser: ${relative}`);
  }
  if (/req\.clone\(\)\.json\s*\(/.test(source)) {
    fail(`unauthenticated cloned request parser: ${relative}`);
  }
}

// transactions.idempotency_key is NOT NULL and UNIQUE in the schema. Every
// literal insert/upsert must carry the fence before any value-moving result is
// persisted, otherwise a successful chain operation can surface as an app error.
for (const file of tsFiles) {
  const source = fs.readFileSync(file, "utf8");
  const relative = path.relative(root, file).replaceAll(path.sep, "/");
  const pattern = /\.from\(\s*["']transactions["']\s*\)\s*\.(?:insert|upsert)\s*\(\s*/g;
  for (const match of source.matchAll(pattern)) {
    const objectStart = match.index + match[0].length;
    if (source[objectStart] !== "{") {
      fail(`transaction write must use an auditable literal row: ${relative}`);
      continue;
    }
    const objectEnd = balancedObjectEnd(source, objectStart);
    if (objectEnd < 0) {
      fail(`transaction write object could not be parsed: ${relative}`);
      continue;
    }
    const row = source.slice(objectStart, objectEnd + 1);
    if (!/\bidempotency_key\s*:/.test(row)) {
      fail(`transaction write is missing idempotency_key: ${relative}`);
    }
  }
}

const moduleFiles = [
  ...walk(path.join(root, "src")),
  ...walk(edgeRoot),
].filter((file) => /\.(?:ts|tsx)$/.test(file));
for (const file of moduleFiles) {
  const source = fs.readFileSync(file, "utf8");
  const relative = path.relative(root, file).replaceAll(path.sep, "/");
  const importPatterns = [
    /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g,
    /import\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of importPatterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (!specifier.startsWith(".")) continue;
      if (!relativeModuleExists(file, specifier)) {
        fail(`unresolved relative import ${specifier}: ${relative}`);
      }
    }
  }
}

const secretPatterns = [
  ["PEM private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["JWT-like credential", /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["provider API key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/],
  ["Telegram bot token", /\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/],
  ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["GitHub token", /\bgh[opsu]_[A-Za-z0-9]{30,}\b/],
];
for (const file of walk(root)) {
  const relative = path.relative(root, file).replaceAll(path.sep, "/");
  if (relative.startsWith("node_modules/") || relative.startsWith(".git/")) continue;
  if (/\.(?:png|jpe?g|gif|webp|ico|woff2?|ttf|otf|zip|pdf)$/i.test(file)) continue;
  const source = fs.readFileSync(file, "utf8");
  for (const [label, pattern] of secretPatterns) {
    if (pattern.test(source)) fail(`${label} appears hardcoded in ${relative}`);
  }
}

const publicNoJwt = new Set([
  "bug-report",
  "creator-rewards-config",
  "market-data",
  "telegram-verify",
  "user-profile-data",
  "x-oauth",
]);
const authMarkers = [
  "isCronAuthorized",
  "runStageWorker",
  "requireAgentApiKey",
  "getCallerUserId",
  "redeemOnboardingToken",
  "verifyTelegramWebhookRequest",
  "verifyTwilioSignature",
];
const noJwt = [...config.matchAll(/\[functions\.([^\]]+)\]\s*\nverify_jwt\s*=\s*false/g)]
  .map((match) => match[1]);
for (const name of noJwt) {
  if (publicNoJwt.has(name)) continue;
  const file = `supabase/functions/${name}/index.ts`;
  if (!exists(file)) {
    fail(`verify_jwt=false function is missing: ${name}`);
    continue;
  }
  const source = read(file);
  if (!authMarkers.some((marker) => source.includes(marker))) {
    fail(`verify_jwt=false function has no recognized application auth gate: ${name}`);
  }
}

for (const worker of functionDirs.filter((name) => name.startsWith("worker-"))) {
  const source = read(`supabase/functions/${worker}/index.ts`);
  if (!source.includes("runStageWorker")) {
    fail(`queue worker bypasses the shared lease/fencing runtime: ${worker}`);
  }
}

const actionRuntime = read("supabase/functions/_shared/linkr_action_runtime.ts");
if (/^import\s+.*(?:ethers|solana|pump)/m.test(actionRuntime)) {
  fail("action runtime statically imports chain SDKs instead of lazy action branches");
}
const terminalAction = read("supabase/functions/terminal-action/index.ts");
if (/^import[\s\S]*?from ["'][^"']*linkr_action_runtime\.ts["']/m.test(terminalAction)) {
  fail("terminal-action statically imports the heavy action runtime");
}
for (const file of [
  "supabase/functions/_shared/linkr_agent_runtime.ts",
  "supabase/functions/_shared/linkr_action_dispatch.ts",
]) {
  const source = read(file);
  if (/briefly unavailable|moving to a dedicated execution worker/i.test(source)) {
    fail(`capability-degrading fallback remains in ${file}`);
  }
}

const packageJson = JSON.parse(read("package.json"));
for (const [name, command] of Object.entries(packageJson.scripts ?? {})) {
  for (const match of String(command).matchAll(/scripts\/([^\s"']+)/g)) {
    const scriptPath = `scripts/${match[1]}`;
    if (!exists(scriptPath)) fail(`package script ${name} references missing ${scriptPath}`);
  }
}

const largeCss = walk(path.join(root, "src"))
  .filter((file) => file.endsWith(".css") && fs.statSync(file).size > 1024 * 1024);
for (const file of largeCss) {
  warnings.push(`large CSS source remains a future decomposition target: ${path.relative(root, file)}`);
}

if (warnings.length) {
  console.log("Architecture warnings:");
  for (const warning of warnings) console.log(`  - ${warning}`);
}
if (failures.length) {
  console.error("Architecture audit failed:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`Architecture audit passed (${functionDirs.length} edge functions, ${tsFiles.length} edge TypeScript files).`);

function balancedObjectEnd(source, start) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index++;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index++;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index++;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth++;
    if (char === "}") {
      depth--;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (
      entry.isDirectory() &&
      [
        ".git",
        ".vercel",
        "node_modules",
        "dist",
        "artifacts",
        "cache",
      ].includes(entry.name)
    ) {
      return [];
    }
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function relativeModuleExists(importer, rawSpecifier) {
  const specifier = rawSpecifier.split(/[?#]/, 1)[0];
  const base = path.resolve(path.dirname(importer), specifier);
  return [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.json`,
    `${base}.css`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
    path.join(base, "index.js"),
  ].some((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}
