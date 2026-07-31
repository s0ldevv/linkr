// Database-backed operational policies. Defaults are intentionally safe so a
// code deploy before its migration fails closed for funding/testing overrides
// and open for X gating unless an admin explicitly configures thresholds.
// deno-lint-ignore-file no-explicit-any

export type LaunchFundingMode =
  | "funding_disabled"
  | "first_eligible_launch"
  | "fund_every_eligible_launch";

export interface LaunchFundingPolicy {
  mode: LaunchFundingMode;
}

export interface XUserGatingPolicy {
  min_followers_enabled: boolean;
  min_followers: number;
  min_following_enabled: boolean;
  min_following: number;
  min_posts_enabled: boolean;
  min_posts: number;
}

export interface MetadataTestingPolicy {
  enabled: boolean;
  test_website_url: string | null;
  test_twitter_url: string | null;
  test_telegram_url: string | null;
}

export interface LaunchCooldownPolicy {
  enabled: boolean;
  duration_minutes: number;
}

export interface XUserMetrics {
  followers_count?: number | null;
  following_count?: number | null;
  tweet_count?: number | null;
}

export interface XGatingEvaluation {
  eligible: boolean;
  reason: string | null;
  x_user_id: string;
  username: string | null;
  public_metrics: XUserMetrics;
  policy: XUserGatingPolicy;
  checked_at: string;
}

export const DEFAULT_LAUNCH_FUNDING_POLICY: LaunchFundingPolicy = {
  mode: "first_eligible_launch",
};

export const DEFAULT_X_USER_GATING_POLICY: XUserGatingPolicy = {
  min_followers_enabled: false,
  min_followers: 0,
  min_following_enabled: false,
  min_following: 0,
  min_posts_enabled: false,
  min_posts: 0,
};

export const DEFAULT_METADATA_TESTING_POLICY: MetadataTestingPolicy = {
  enabled: false,
  test_website_url: null,
  test_twitter_url: null,
  test_telegram_url: null,
};

export const DEFAULT_LAUNCH_COOLDOWN_POLICY: LaunchCooldownPolicy = {
  enabled: false,
  duration_minutes: 60,
};

export async function readLaunchFundingPolicy(
  admin: any,
): Promise<LaunchFundingPolicy> {
  const value = await readSetting(admin, "launch_funding_policy");
  return normalizeLaunchFundingPolicy(value);
}

export async function readXUserGatingPolicy(
  admin: any,
): Promise<XUserGatingPolicy> {
  const value = await readSetting(admin, "x_user_gating_policy");
  return normalizeXUserGatingPolicy(value);
}

export async function readMetadataTestingPolicy(
  admin: any,
): Promise<MetadataTestingPolicy> {
  const value = await readSetting(admin, "metadata_testing_policy");
  return normalizeMetadataTestingPolicy(value);
}

export async function readLaunchCooldownPolicy(
  admin: any,
): Promise<LaunchCooldownPolicy> {
  const value = await readSetting(admin, "launch_cooldown_policy");
  return normalizeLaunchCooldownPolicy(value);
}

export async function readAllAdminSettings(
  admin: any,
): Promise<Record<string, unknown>> {
  try {
    const { data, error } = await admin.rpc("get_linkr_admin_settings_v1");
    if (error) throw error;
    return {
      launch_funding_policy: normalizeLaunchFundingPolicy(
        data?.launch_funding_policy,
      ),
      x_user_gating_policy: normalizeXUserGatingPolicy(
        data?.x_user_gating_policy,
      ),
      metadata_testing_policy: normalizeMetadataTestingPolicy(
        data?.metadata_testing_policy,
      ),
      launch_cooldown_policy: normalizeLaunchCooldownPolicy(
        data?.launch_cooldown_policy,
      ),
    };
  } catch (_) {
    return {
      launch_funding_policy: DEFAULT_LAUNCH_FUNDING_POLICY,
      x_user_gating_policy: DEFAULT_X_USER_GATING_POLICY,
      metadata_testing_policy: DEFAULT_METADATA_TESTING_POLICY,
      launch_cooldown_policy: DEFAULT_LAUNCH_COOLDOWN_POLICY,
    };
  }
}

export async function setAdminSetting(args: {
  admin: any;
  key: string;
  value: unknown;
  adminUserId: string;
  reason?: string | null;
  requestId?: string | null;
}): Promise<unknown> {
  const value = args.key === "metadata_testing_policy"
    ? normalizeMetadataTestingPolicy(args.value)
    : args.value ?? {};
  const { data, error } = await args.admin.rpc("set_linkr_admin_setting_v1", {
    p_key: args.key,
    p_value: value,
    p_admin_user_id: args.adminUserId,
    p_reason: args.reason ?? null,
    p_request_id: args.requestId ?? null,
  });
  if (error) {
    const code = adminSettingErrorCode(error);
    throw new Error(code ?? "admin_setting_update_failed");
  }
  if (args.key === "launch_funding_policy") {
    return normalizeLaunchFundingPolicy(data);
  }
  if (args.key === "x_user_gating_policy") {
    return normalizeXUserGatingPolicy(data);
  }
  if (args.key === "metadata_testing_policy") {
    return normalizeMetadataTestingPolicy(data);
  }
  if (args.key === "launch_cooldown_policy") {
    return normalizeLaunchCooldownPolicy(data);
  }
  return data;
}

export async function evaluateXUserGating(args: {
  admin: any;
  xUserId: string;
  username?: string | null;
  publicMetrics?: unknown;
  source?: string | null;
}): Promise<XGatingEvaluation> {
  const metrics = normalizeXUserMetrics(args.publicMetrics);
  try {
    const { data, error } = await args.admin.rpc(
      "evaluate_linkr_x_user_gating_v1",
      {
        p_x_user_id: args.xUserId,
        p_username: args.username ?? null,
        p_public_metrics: metrics,
        p_source: args.source ?? "edge",
      },
    );
    if (error) throw error;
    return normalizeXGatingEvaluation(
      data,
      args.xUserId,
      args.username,
      metrics,
    );
  } catch (_) {
    const policy = await readXUserGatingPolicy(args.admin);
    return evaluateXUserGatingLocally(
      args.xUserId,
      args.username ?? null,
      metrics,
      policy,
    );
  }
}

async function readSetting(admin: any, key: string): Promise<unknown> {
  try {
    const { data, error } = await admin.rpc("get_linkr_admin_setting_v1", {
      p_key: key,
    });
    if (error) throw error;
    return data;
  } catch (_) {
    return null;
  }
}

export function normalizeLaunchFundingPolicy(
  value: unknown,
): LaunchFundingPolicy {
  const row = record(value);
  const mode = String(row.mode ?? DEFAULT_LAUNCH_FUNDING_POLICY.mode);
  if (
    mode === "funding_disabled" ||
    mode === "first_eligible_launch" ||
    mode === "fund_every_eligible_launch"
  ) {
    return { mode };
  }
  return DEFAULT_LAUNCH_FUNDING_POLICY;
}

export function normalizeXUserGatingPolicy(value: unknown): XUserGatingPolicy {
  const row = record(value);
  return {
    min_followers_enabled: row.min_followers_enabled === true,
    min_followers: boundedInteger(row.min_followers, 0, 1_000_000_000),
    min_following_enabled: row.min_following_enabled === true,
    min_following: boundedInteger(row.min_following, 0, 1_000_000_000),
    min_posts_enabled: row.min_posts_enabled === true,
    min_posts: boundedInteger(row.min_posts, 0, 1_000_000_000),
  };
}

export function normalizeMetadataTestingPolicy(
  value: unknown,
): MetadataTestingPolicy {
  const row = record(value);
  const enabled = row.enabled === true;
  return {
    enabled,
    test_website_url: normalizeOptionalHttpsUrl(row.test_website_url),
    test_twitter_url: normalizeOptionalHttpsUrl(row.test_twitter_url, {
      allowedHosts: ["x.com", "twitter.com"],
    }),
    test_telegram_url: normalizeOptionalHttpsUrl(row.test_telegram_url, {
      allowedHosts: ["t.me", "telegram.me"],
    }),
  };
}

export function normalizeLaunchCooldownPolicy(
  value: unknown,
): LaunchCooldownPolicy {
  const row = record(value);
  return {
    enabled: row.enabled === true,
    duration_minutes: boundedInteger(row.duration_minutes ?? 60, 1, 10_080),
  };
}

export function normalizeXUserMetrics(value: unknown): XUserMetrics {
  const row = record(value);
  return {
    followers_count: boundedInteger(row.followers_count, 0, 1_000_000_000),
    following_count: boundedInteger(row.following_count, 0, 1_000_000_000),
    tweet_count: boundedInteger(row.tweet_count, 0, 1_000_000_000),
  };
}

function normalizeXGatingEvaluation(
  value: unknown,
  xUserId: string,
  username: string | null | undefined,
  metrics: XUserMetrics,
): XGatingEvaluation {
  const row = record(value);
  return {
    eligible: row.eligible !== false,
    reason: typeof row.reason === "string" && row.reason.trim()
      ? row.reason.trim()
      : null,
    x_user_id: String(row.x_user_id ?? xUserId),
    username: typeof row.username === "string" && row.username.trim()
      ? row.username.trim()
      : username ?? null,
    public_metrics: normalizeXUserMetrics(row.public_metrics ?? metrics),
    policy: normalizeXUserGatingPolicy(row.policy),
    checked_at: typeof row.checked_at === "string"
      ? row.checked_at
      : new Date().toISOString(),
  };
}

function evaluateXUserGatingLocally(
  xUserId: string,
  username: string | null,
  metrics: XUserMetrics,
  policy: XUserGatingPolicy,
): XGatingEvaluation {
  let reason: string | null = null;
  if (
    policy.min_followers_enabled &&
    Number(metrics.followers_count ?? 0) < policy.min_followers
  ) {
    reason = "below_min_followers";
  } else if (
    policy.min_following_enabled &&
    Number(metrics.following_count ?? 0) < policy.min_following
  ) {
    reason = "below_min_following";
  } else if (
    policy.min_posts_enabled &&
    Number(metrics.tweet_count ?? 0) < policy.min_posts
  ) {
    reason = "below_min_posts";
  }
  return {
    eligible: reason == null,
    reason,
    x_user_id: xUserId,
    username,
    public_metrics: metrics,
    policy,
    checked_at: new Date().toISOString(),
  };
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number {
  const number = Math.floor(Number(value ?? minimum));
  if (!Number.isFinite(number)) return minimum;
  return Math.min(maximum, Math.max(minimum, number));
}

function normalizeOptionalHttpsUrl(
  value: unknown,
  options: {
    allowedHosts?: string[];
  } = {},
): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
    ? raw
    : `https://${raw}`;
  try {
    const url = new URL(withProtocol);
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    if (options.allowedHosts && !options.allowedHosts.includes(host)) {
      return null;
    }
    return url.toString();
  } catch (_) {
    return null;
  }
}

function adminSettingErrorCode(error: unknown): string | null {
  const row = record(error);
  const message = String(row.message ?? "").trim();
  const direct = simpleAdminSettingError(message);
  if (direct) return direct;
  const match = message.match(
    /\b(invalid_[a-z0-9_]+|x_gating_threshold_out_of_range|unknown_admin_setting(?::[a-z0-9_]+)?)\b/i,
  );
  return simpleAdminSettingError(match?.[1]);
}

function simpleAdminSettingError(value: unknown): string | null {
  const text = String(value ?? "").trim().toLowerCase();
  if (text.startsWith("unknown_admin_setting")) return "unknown_admin_setting";
  if (/^(invalid_[a-z0-9_]+|x_gating_threshold_out_of_range)$/.test(text)) {
    return text;
  }
  return null;
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" ? value as Record<string, any> : {};
}
