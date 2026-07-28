import fs from "node:fs";
import path from "node:path";

const root = path.join(process.cwd(), "supabase/functions");
const maxEntryBytes = Number(process.env.LINKR_MAX_EDGE_ENTRY_BYTES ?? 128 * 1024);
const maxSharedBytes = Number(process.env.LINKR_MAX_EDGE_SHARED_BYTES ?? 256 * 1024);
const failures = [];
let files = 0;
let bytes = 0;

for (const file of walk(root).filter((value) => value.endsWith(".ts"))) {
  const size = fs.statSync(file).size;
  const relative = path.relative(process.cwd(), file).replaceAll(path.sep, "/");
  const isEntry = relative.endsWith("/index.ts");
  const limit = isEntry ? maxEntryBytes : maxSharedBytes;
  files += 1;
  bytes += size;
  if (size > limit) failures.push(`${relative} is ${size} bytes (limit ${limit})`);
}

if (failures.length) {
  console.error("Edge source budget failed:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`Edge source budget passed (${files} files, ${(bytes / 1024 / 1024).toFixed(2)} MiB).`);

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}
