import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export type LinkrCredentials = {
  apiKey: string;
  apiUrl: string;
  keyPrefix: string;
  agentProfileId: string;
  installId: string;
  createdAt: string;
};

const CONFIG_DIR = path.join(os.homedir(), ".linkr");
const CONFIG_FILE = path.join(CONFIG_DIR, "credentials.json");

export function credentialsPath(): string {
  return CONFIG_FILE;
}

export async function readCredentials(): Promise<LinkrCredentials | null> {
  try {
    await assertCredentialPermissions();
    const raw = await fs.readFile(CONFIG_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<LinkrCredentials>;
    if (!parsed.apiKey || !parsed.apiUrl || !parsed.keyPrefix || !parsed.agentProfileId) {
      return null;
    }
    return {
      apiKey: parsed.apiKey,
      apiUrl: parsed.apiUrl.replace(/\/+$/, ""),
      keyPrefix: parsed.keyPrefix,
      agentProfileId: parsed.agentProfileId,
      installId: parsed.installId || randomUUID(),
      createdAt: parsed.createdAt || new Date().toISOString(),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw error;
  }
}

export async function writeCredentials(credentials: LinkrCredentials): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await fs.chmod(CONFIG_DIR, 0o700).catch(() => undefined);
  const value = JSON.stringify(credentials, null, 2) + "\n";
  await fs.writeFile(CONFIG_FILE, value, { mode: 0o600 });
  if (process.platform !== "win32") await fs.chmod(CONFIG_FILE, 0o600);
}

export async function deleteCredentials(): Promise<void> {
  await fs.rm(CONFIG_FILE, { force: true });
}

export async function requireCredentials(): Promise<LinkrCredentials> {
  const credentials = await readCredentials();
  if (!credentials) {
    throw new Error("Not logged in. Run linkr login first.");
  }
  return credentials;
}

async function assertCredentialPermissions(): Promise<void> {
  if (process.platform === "win32") return;
  try {
    const stat = await fs.stat(CONFIG_FILE);
    if ((stat.mode & 0o077) !== 0) {
      throw new Error(`${CONFIG_FILE} is readable by other users. Run: chmod 600 ${CONFIG_FILE}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return;
    throw error;
  }
}
