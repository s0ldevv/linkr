// deno-lint-ignore-file no-explicit-any

export interface CronLockOptions {
  name: string;
  ttlSeconds: number;
  allowWithoutRpc?: boolean;
}

export type CronLockResult<T> =
  | { locked: true; owner: string }
  | { locked: false; owner: string; result: T; lockUnavailable?: boolean };

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = Deno.env.get(name);
  if (raw == null || raw.trim() === "") return fallback;
  if (/^(1|true|yes|on)$/i.test(raw)) return true;
  if (/^(0|false|no|off)$/i.test(raw)) return false;
  return fallback;
}

export async function withCronLock<T>(
  admin: any,
  options: CronLockOptions,
  fn: (lock: { owner: string }) => Promise<T>,
): Promise<CronLockResult<T>> {
  const owner = crypto.randomUUID();
  const enabled = readBoolean("LINKR_CRON_LOCKS_ENABLED", true);
  const allowWithoutRpc = options.allowWithoutRpc ?? true;

  if (!enabled) {
    return { locked: false, owner, result: await fn({ owner }) };
  }

  let claimed = false;
  let lockUnavailable = false;

  try {
    const { data, error } = await admin.rpc("claim_cron_lock", {
      p_lock_name: options.name,
      p_owner: owner,
      p_ttl_seconds: options.ttlSeconds,
    });
    if (error) throw error;
    claimed = data === true;
  } catch (error) {
    if (!allowWithoutRpc) throw error;
    lockUnavailable = true;
    return { locked: false, owner, result: await fn({ owner }), lockUnavailable };
  }

  if (!claimed) return { locked: true, owner };

  try {
    return { locked: false, owner, result: await fn({ owner }), lockUnavailable };
  } finally {
    try {
      await admin.rpc("release_cron_lock", {
        p_lock_name: options.name,
        p_owner: owner,
      });
    } catch (_) {
      // The TTL is the safety net. A release failure must not hide job results.
    }
  }
}
