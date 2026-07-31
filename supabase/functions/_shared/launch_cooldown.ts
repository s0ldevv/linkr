import {
  DEFAULT_LAUNCH_COOLDOWN_POLICY,
  normalizeLaunchCooldownPolicy,
} from "./admin_settings.ts";

export type LaunchCooldownStatus = {
  enabled: boolean;
  allowed: boolean;
  duration_minutes: number;
  last_launch_at: string | null;
  cooldown_until: string | null;
  retry_after_seconds: number;
};

export async function readLaunchCooldown(
  admin: any,
  userId: string,
): Promise<LaunchCooldownStatus> {
  try {
    const { data, error } = await admin.rpc("get_linkr_launch_cooldown_v1", {
      p_user_id: userId,
    });
    if (error) throw error;
    return normalizeLaunchCooldownStatus(data);
  } catch (_) {
    // The policy is disabled by default. A code deploy before the migration
    // must preserve normal launch behavior rather than block users.
    return {
      enabled: DEFAULT_LAUNCH_COOLDOWN_POLICY.enabled,
      allowed: true,
      duration_minutes: DEFAULT_LAUNCH_COOLDOWN_POLICY.duration_minutes,
      last_launch_at: null,
      cooldown_until: null,
      retry_after_seconds: 0,
    };
  }
}

export function launchCooldownMessage(status: LaunchCooldownStatus): string {
  const minutes = Math.max(1, Math.ceil(status.retry_after_seconds / 60));
  return `You already launched a coin recently. Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

export function normalizeLaunchCooldownStatus(value: unknown): LaunchCooldownStatus {
  const row = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  return {
    enabled: row.enabled === true,
    allowed: row.allowed !== false,
    duration_minutes: normalizeLaunchCooldownPolicy({
      enabled: row.enabled,
      duration_minutes: row.duration_minutes,
    }).duration_minutes,
    last_launch_at: typeof row.last_launch_at === "string"
      ? row.last_launch_at
      : null,
    cooldown_until: typeof row.cooldown_until === "string"
      ? row.cooldown_until
      : null,
    retry_after_seconds: Math.max(0, Number(row.retry_after_seconds ?? 0)),
  };
}
