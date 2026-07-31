import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  Ban,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FlaskConical,
  Loader2,
  LogOut,
  RefreshCw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Twitter,
  UserX,
} from "lucide-react";
import { toast } from "sonner";
import { Logo } from "@/components/linkr/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";

type BotTokenStatus = {
  account_key: string;
  bot_handle: string;
  expires_at: string;
  expires_in_seconds: number | null;
  is_active: boolean;
  last_error: string | null;
  last_refresh_attempt_at: string | null;
  last_refresh_status: string | null;
  last_refreshed_at: string | null;
  needs_reauth: boolean;
  scope: string | null;
  token_type: string | null;
  updated_at: string;
  x_user_id: string | null;
};

type PostingAuthStatus = {
  mode: "oauth1" | "oauth2" | "unknown";
  configured: boolean;
  expected_user_id: string | null;
  expected_handle: string;
  last_verified_at: string | null;
  last_verification_status: string | null;
  last_error: string | null;
  needs_attention: boolean;
};

type BanRow = {
  id: string;
  x_user_id: string;
  username_at_ban: string | null;
  display_name_at_ban: string | null;
  profile_image_url: string | null;
  reason: string | null;
  is_active: boolean;
  banned_at: string;
  unbanned_at: string | null;
  updated_at: string;
};

type HealthRow = {
  source: string;
  status: string;
  details: unknown;
  checked_at: string;
};

type LaunchFundingMode =
  "funding_disabled" | "first_eligible_launch" | "fund_every_eligible_launch";

type LaunchFundingPolicy = {
  mode: LaunchFundingMode;
};

type XUserGatingPolicy = {
  min_followers_enabled: boolean;
  min_followers: number;
  min_following_enabled: boolean;
  min_following: number;
  min_posts_enabled: boolean;
  min_posts: number;
};

type MetadataTestingPolicy = {
  enabled: boolean;
  test_website_url: string | null;
  test_twitter_url: string | null;
  test_telegram_url: string | null;
};

type LaunchCooldownPolicy = {
  enabled: boolean;
  duration_minutes: number;
};

type SecretPanelSettings = {
  launch_funding_policy: LaunchFundingPolicy;
  x_user_gating_policy: XUserGatingPolicy;
  metadata_testing_policy: MetadataTestingPolicy;
  launch_cooldown_policy: LaunchCooldownPolicy;
};

type SecretPanelStatus = {
  ok: boolean;
  oauth_login_url: string | null;
  oauth_login_configured: boolean;
  pending_replies: number;
  posting_auth: PostingAuthStatus;
  bot_token: BotTokenStatus | null;
  bans: BanRow[];
  health: HealthRow[];
  platform: {
    control: { mode: string; threshold_band: string; updated_at: string } | null;
    queues: Array<{
      stage: string;
      enabled: boolean;
      queue_length: number;
      oldest_age_seconds: number;
      dispatch_state: string;
      dispatch_failure_count: number;
    }>;
    open_incidents: Array<{
      id: string;
      severity: string;
      title: string;
      last_seen_at: string;
    }>;
    pending_dlq_count: number;
    controller_cron: { active: boolean } | null;
  };
  settings: SecretPanelSettings;
  admin: {
    user_id: string;
    identity: {
      twitterId: string | null;
      username: string | null;
    };
  };
};

type SecretPanelActionResult = SecretPanelStatus & {
  setting?: unknown;
};

type SettingMutationInput = {
  key: keyof SecretPanelSettings;
  value: unknown;
  reason?: string;
};

function supabaseFunctionsUrl(functionName: string) {
  const supabaseUrl =
    import.meta.env.VITE_SUPABASE_URL ||
    (typeof process !== "undefined" ? process.env.SUPABASE_URL : undefined);
  if (!supabaseUrl) throw new Error("Supabase URL is not configured.");
  return `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/${functionName}`;
}

async function getSessionToken() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("You need to sign in as @linkrbot.");
  return token;
}

async function fetchSecretPanel(): Promise<SecretPanelStatus> {
  const token = await getSessionToken();
  const response = await fetch(supabaseFunctionsUrl("secretpanel"), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error ?? "Could not load secret panel.");
  }
  return body as SecretPanelStatus;
}

async function postSecretPanel(body: Record<string, unknown>): Promise<SecretPanelActionResult> {
  const token = await getSessionToken();
  const response = await fetch(supabaseFunctionsUrl("secretpanel"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message ?? data.error ?? "Secret panel action failed.");
  }
  return data as SecretPanelActionResult;
}

function patchSecretPanelSetting(
  status: SecretPanelStatus | undefined,
  input: SettingMutationInput,
  value: unknown = input.value,
): SecretPanelStatus | undefined {
  if (!status) return status;
  return {
    ...status,
    settings: {
      ...status.settings,
      [input.key]: value,
    } as SecretPanelSettings,
  };
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Never";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function boundedNumber(value: string, fallback = 0) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, number);
}

export const Route = createFileRoute("/secretpanel")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({ to: "/auth", search: { returnTo: location.href } });
    }
    return { userId: data.session.user.id };
  },
  head: () => ({
    meta: [
      { title: "Secret Panel - Linkr" },
      { name: "description", content: "Linkr admin controls." },
    ],
  }),
  component: SecretPanelPage,
});

function SecretPanelPage() {
  const queryClient = useQueryClient();
  const [handle, setHandle] = useState("");
  const [reason, setReason] = useState("");
  const statusQuery = useQuery({
    queryKey: ["secretpanel"],
    queryFn: fetchSecretPanel,
    refetchInterval: 30_000,
  });

  const banMutation = useMutation({
    mutationFn: () => postSecretPanel({ action: "ban_handle", handle, reason }),
    onSuccess: async () => {
      toast.success("X account banned");
      setHandle("");
      setReason("");
      await statusQuery.refetch();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not ban X account.");
    },
  });

  const unbanMutation = useMutation({
    mutationFn: (xUserId: string) => postSecretPanel({ action: "unban", x_user_id: xUserId }),
    onSuccess: async () => {
      toast.success("X account unbanned");
      await statusQuery.refetch();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not unban X account.");
    },
  });

  const verifyPostingMutation = useMutation({
    mutationFn: () => postSecretPanel({ action: "verify_posting_auth" }),
    onSuccess: async () => {
      toast.success("X posting credentials verified");
      await statusQuery.refetch();
    },
    onError: async (error) => {
      toast.error(error instanceof Error ? error.message : "Could not verify X credentials.");
      await statusQuery.refetch();
    },
  });

  const settingMutation = useMutation({
    mutationFn: (input: SettingMutationInput) =>
      postSecretPanel({
        action: "update_admin_setting",
        key: input.key,
        value: input.value,
        reason: input.reason ?? "secretpanel policy update",
      }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["secretpanel"] });
      const previousStatus = queryClient.getQueryData<SecretPanelStatus>(["secretpanel"]);
      queryClient.setQueryData<SecretPanelStatus>(["secretpanel"], (current) =>
        patchSecretPanelSetting(current, input),
      );
      return { previousStatus };
    },
    onSuccess: (data, input) => {
      const savedValue = data.setting ?? data.settings?.[input.key] ?? input.value;
      queryClient.setQueryData<SecretPanelStatus>(
        ["secretpanel"],
        patchSecretPanelSetting(data, input, savedValue),
      );
      toast.success("Policy saved");
    },
    onError: (error, _input, context) => {
      if (context?.previousStatus) {
        queryClient.setQueryData(["secretpanel"], context.previousStatus);
      }
      toast.error(error instanceof Error ? error.message : "Could not save policy.");
    },
  });

  const status = statusQuery.data;
  const activeBans = useMemo(
    () => (status?.bans ?? []).filter((item) => item.is_active),
    [status?.bans],
  );
  const inactiveBans = useMemo(
    () => (status?.bans ?? []).filter((item) => !item.is_active),
    [status?.bans],
  );
  const botHealthy =
    !!status?.posting_auth?.configured &&
    !status.posting_auth.needs_attention &&
    status.posting_auth.last_verification_status === "ok";

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  return (
    <main className="min-h-screen bg-[#f6f7f2] px-5 py-5 text-[#0a0d0b]">
      <header className="mx-auto flex w-full max-w-7xl items-center justify-between">
        <Logo to="/" />
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => statusQuery.refetch()}
            disabled={statusQuery.isFetching}
          >
            <RefreshCw
              aria-hidden="true"
              className={statusQuery.isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"}
            />
            Refresh
          </Button>
          <Button type="button" variant="outline" onClick={signOut}>
            <LogOut aria-hidden="true" className="h-4 w-4" />
            Sign out
          </Button>
        </div>
      </header>

      <section className="mx-auto mt-10 w-full max-w-7xl">
        <div className="mb-7">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[#66706b]">Admin</p>
          <h1 className="mt-2 text-4xl font-black tracking-tight">Secret panel</h1>
        </div>

        {statusQuery.isLoading ? (
          <div className="flex min-h-[360px] items-center justify-center rounded-lg border border-[#d9decf] bg-white">
            <Loader2 aria-hidden="true" className="h-6 w-6 animate-spin" />
          </div>
        ) : statusQuery.isError ? (
          <div className="rounded-lg border border-[#ffd4d4] bg-white p-6">
            <div className="flex items-center gap-3 text-[#b42318]">
              <CircleAlert aria-hidden="true" className="h-5 w-5" />
              <strong>Access denied</strong>
            </div>
            <p className="mt-3 text-sm text-[#66706b]">
              {statusQuery.error instanceof Error
                ? statusQuery.error.message
                : "This page is only available to @linkrbot."}
            </p>
          </div>
        ) : status ? (
          <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
            <section className="rounded-lg border border-[#d9decf] bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.12em] text-[#66706b]">
                    X posting credentials
                  </p>
                  <h2 className="mt-2 flex items-center gap-2 text-2xl font-black">
                    {botHealthy ? (
                      <CheckCircle2 aria-hidden="true" className="h-6 w-6 text-[#0f8f3a]" />
                    ) : (
                      <CircleAlert aria-hidden="true" className="h-6 w-6 text-[#b42318]" />
                    )}
                    @{status.posting_auth.expected_handle ?? "linkrbot"}
                  </h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  {status.oauth_login_url ? (
                    <Button asChild>
                      <a href={status.oauth_login_url} target="_blank" rel="noreferrer">
                        <Twitter aria-hidden="true" className="h-4 w-4" />
                        Connect @{status.posting_auth.expected_handle ?? "linkrbot"}
                      </a>
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant={status.oauth_login_url ? "outline" : "default"}
                    onClick={() => verifyPostingMutation.mutate()}
                    disabled={verifyPostingMutation.isPending}
                  >
                    {verifyPostingMutation.isPending ? (
                      <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                    ) : (
                      <Twitter aria-hidden="true" className="h-4 w-4" />
                    )}
                    Verify credentials
                  </Button>
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <StatusItem label="Status" value={botHealthy ? "Verified" : "Needs attention"} />
                <StatusItem label="Auth mode" value={status.posting_auth.mode} />
                <StatusItem
                  label="Configured"
                  value={status.posting_auth.configured ? "Yes" : "No"}
                />
                <StatusItem
                  label="Last verified"
                  value={formatDate(status.posting_auth.last_verified_at)}
                />
                <StatusItem label="Pending replies" value={String(status.pending_replies)} />
                <StatusItem
                  label="Verification status"
                  value={status.posting_auth.last_verification_status ?? "Not checked"}
                />
                <StatusItem
                  label="X user id"
                  value={status.posting_auth.expected_user_id ?? "Unknown"}
                />
              </div>

              {status.posting_auth.last_error ? (
                <pre className="mt-4 max-h-32 overflow-auto rounded-md bg-[#111511] p-3 text-xs leading-5 text-[#d8ff7a]">
                  {status.posting_auth.last_error}
                </pre>
              ) : null}

              {status.posting_auth.mode === "oauth2" && status.oauth_login_url ? (
                <p className="mt-4 text-xs text-[#66706b]">
                  OAuth 2.0 bot login is available for posting. After connecting, refresh this panel
                  and verify the active token.
                </p>
              ) : null}
            </section>

            <section className="rounded-lg border border-[#d9decf] bg-white p-5 shadow-sm lg:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.12em] text-[#66706b]">
                    Queue platform health
                  </p>
                  <h2 className="mt-1 text-2xl font-black">
                    {status.platform.control?.mode ?? "unknown"}
                  </h2>
                </div>
                <span className="rounded-full bg-[#f6f7f2] px-3 py-2 text-xs font-bold">
                  DLQ {status.platform.pending_dlq_count} · controller{" "}
                  {status.platform.controller_cron?.active ? "active" : "inactive"}
                </span>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {status.platform.queues.map((queue) => (
                  <div key={queue.stage} className="rounded-md bg-[#f6f7f2] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <strong className="text-sm">{queue.stage}</strong>
                      <span className="text-xs font-bold">
                        {queue.enabled ? queue.dispatch_state : "disabled"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[#66706b]">
                      {queue.queue_length} queued · oldest {queue.oldest_age_seconds}s ·{" "}
                      {queue.dispatch_failure_count} dispatch failures
                    </p>
                  </div>
                ))}
              </div>
              {status.platform.open_incidents.length ? (
                <div className="mt-4 space-y-2">
                  {status.platform.open_incidents.map((incident) => (
                    <div
                      key={incident.id}
                      className="rounded-md border border-[#d9decf] p-3 text-sm"
                    >
                      <strong>
                        {incident.severity}: {incident.title}
                      </strong>
                      <p className="text-xs text-[#66706b]">{formatDate(incident.last_seen_at)}</p>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>

            <PolicyControls
              settings={status.settings}
              savingKey={
                settingMutation.isPending ? (settingMutation.variables?.key ?? null) : null
              }
              onSave={(key, value) =>
                settingMutation.mutate({
                  key,
                  value,
                  reason: "secretpanel policy update",
                })
              }
            />

            <section className="rounded-lg border border-[#d9decf] bg-white p-5 shadow-sm">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-md bg-[#f1ffd0]">
                  <UserX aria-hidden="true" className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.12em] text-[#66706b]">
                    Ban X account
                  </p>
                  <h2 className="mt-1 text-2xl font-black">Block by handle</h2>
                </div>
              </div>

              <form
                className="mt-5 space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  banMutation.mutate();
                }}
              >
                <label className="block">
                  <span className="text-sm font-bold">X handle</span>
                  <input
                    className="mt-1 h-11 w-full rounded-md border border-[#cfd7c7] bg-white px-3 text-sm outline-none focus:border-[#9ec600]"
                    value={handle}
                    onChange={(event) => setHandle(event.target.value)}
                    placeholder="@handle"
                    autoComplete="off"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-bold">Reason</span>
                  <input
                    className="mt-1 h-11 w-full rounded-md border border-[#cfd7c7] bg-white px-3 text-sm outline-none focus:border-[#9ec600]"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Optional"
                  />
                </label>
                <Button
                  type="submit"
                  disabled={!handle.trim() || banMutation.isPending}
                  className="w-full"
                >
                  {banMutation.isPending ? (
                    <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                  ) : (
                    <Ban aria-hidden="true" className="h-4 w-4" />
                  )}
                  Ban account
                </Button>
              </form>
            </section>

            <section className="rounded-lg border border-[#d9decf] bg-white p-5 shadow-sm lg:col-span-2">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.12em] text-[#66706b]">
                    Active bans
                  </p>
                  <h2 className="mt-1 text-2xl font-black">{activeBans.length} blocked</h2>
                </div>
                <ShieldCheck aria-hidden="true" className="h-6 w-6 text-[#66706b]" />
              </div>

              <div className="overflow-hidden rounded-lg border border-[#d9decf]">
                {activeBans.length ? (
                  activeBans.map((ban) => (
                    <BanListItem
                      key={ban.id}
                      ban={ban}
                      actionLabel="Unban"
                      loading={unbanMutation.isPending}
                      onAction={() => unbanMutation.mutate(ban.x_user_id)}
                    />
                  ))
                ) : (
                  <p className="p-4 text-sm text-[#66706b]">No active bans.</p>
                )}
              </div>
            </section>

            <section className="rounded-lg border border-[#d9decf] bg-white p-5 shadow-sm">
              <p className="text-sm font-semibold uppercase tracking-[0.12em] text-[#66706b]">
                Recent X pipeline health
              </p>
              <div className="mt-4 space-y-3">
                {status.health.map((row) => (
                  <div
                    key={`${row.source}-${row.checked_at}`}
                    className="rounded-md bg-[#f6f7f2] p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <strong className="text-sm">{row.source}</strong>
                      <span className="rounded-full bg-white px-2 py-1 text-xs font-bold">
                        {row.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[#66706b]">{formatDate(row.checked_at)}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-[#d9decf] bg-white p-5 shadow-sm">
              <p className="text-sm font-semibold uppercase tracking-[0.12em] text-[#66706b]">
                Recent unbans
              </p>
              <div className="mt-4 overflow-hidden rounded-lg border border-[#d9decf]">
                {inactiveBans.length ? (
                  inactiveBans.slice(0, 8).map((ban) => <BanListItem key={ban.id} ban={ban} />)
                ) : (
                  <p className="p-4 text-sm text-[#66706b]">No unbanned accounts.</p>
                )}
              </div>
            </section>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function PolicyControls({
  onSave,
  savingKey,
  settings,
}: {
  onSave: (key: keyof SecretPanelSettings, value: unknown) => void;
  savingKey: keyof SecretPanelSettings | null;
  settings: SecretPanelSettings;
}) {
  const [fundingMode, setFundingMode] = useState<LaunchFundingMode>(
    settings.launch_funding_policy.mode,
  );
  const [gating, setGating] = useState<XUserGatingPolicy>(settings.x_user_gating_policy);
  const [metadata, setMetadata] = useState<MetadataTestingPolicy>(settings.metadata_testing_policy);
  const [cooldown, setCooldown] = useState<LaunchCooldownPolicy>(settings.launch_cooldown_policy);

  useEffect(() => {
    setFundingMode(settings.launch_funding_policy.mode);
    setGating(settings.x_user_gating_policy);
    setMetadata(settings.metadata_testing_policy);
    setCooldown(settings.launch_cooldown_policy);
  }, [settings]);

  return (
    <section className="rounded-lg border border-[#d9decf] bg-white p-5 shadow-sm lg:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-[#66706b]">
            Runtime policies
          </p>
          <h2 className="mt-1 text-2xl font-black">Admin settings</h2>
        </div>
        <SlidersHorizontal aria-hidden="true" className="h-6 w-6 text-[#66706b]" />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-4">
        <div className="rounded-md border border-[#d9decf] p-4">
          <div className="mb-4 flex items-center gap-2">
            <ShieldCheck aria-hidden="true" className="h-5 w-5 text-[#66706b]" />
            <h3 className="text-base font-black">Launch funding</h3>
          </div>
          <Select
            value={fundingMode}
            onValueChange={(value) => setFundingMode(value as LaunchFundingMode)}
          >
            <SelectTrigger className="h-11 border-[#cfd7c7]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="first_eligible_launch">First eligible launch</SelectItem>
              <SelectItem value="fund_every_eligible_launch">Every eligible launch</SelectItem>
              <SelectItem value="funding_disabled">Disabled</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            className="mt-4 w-full"
            disabled={savingKey === "launch_funding_policy"}
            onClick={() => onSave("launch_funding_policy", { mode: fundingMode })}
          >
            {savingKey === "launch_funding_policy" ? (
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            ) : (
              <Save aria-hidden="true" className="h-4 w-4" />
            )}
            Save funding
          </Button>
        </div>

        <div className="rounded-md border border-[#d9decf] p-4">
          <div className="mb-4 flex items-center gap-2">
            <UserX aria-hidden="true" className="h-5 w-5 text-[#66706b]" />
            <h3 className="text-base font-black">X user gates</h3>
          </div>
          <div className="space-y-3">
            <GatingRule
              label="Followers"
              enabled={gating.min_followers_enabled}
              value={gating.min_followers}
              onEnabledChange={(enabled) =>
                setGating((current) => ({
                  ...current,
                  min_followers_enabled: enabled,
                }))
              }
              onValueChange={(value) =>
                setGating((current) => ({ ...current, min_followers: value }))
              }
            />
            <GatingRule
              label="Following"
              enabled={gating.min_following_enabled}
              value={gating.min_following}
              onEnabledChange={(enabled) =>
                setGating((current) => ({
                  ...current,
                  min_following_enabled: enabled,
                }))
              }
              onValueChange={(value) =>
                setGating((current) => ({ ...current, min_following: value }))
              }
            />
            <GatingRule
              label="Posts"
              enabled={gating.min_posts_enabled}
              value={gating.min_posts}
              onEnabledChange={(enabled) =>
                setGating((current) => ({
                  ...current,
                  min_posts_enabled: enabled,
                }))
              }
              onValueChange={(value) => setGating((current) => ({ ...current, min_posts: value }))}
            />
          </div>
          <Button
            type="button"
            className="mt-4 w-full"
            disabled={savingKey === "x_user_gating_policy"}
            onClick={() => onSave("x_user_gating_policy", gating)}
          >
            {savingKey === "x_user_gating_policy" ? (
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            ) : (
              <Save aria-hidden="true" className="h-4 w-4" />
            )}
            Save gates
          </Button>
        </div>

        <div className="rounded-md border border-[#d9decf] p-4">
          <div className="mb-4 flex items-center gap-2">
            <FlaskConical aria-hidden="true" className="h-5 w-5 text-[#66706b]" />
            <h3 className="text-base font-black">Metadata testing</h3>
          </div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="text-sm font-bold">Enabled</span>
            <Switch
              checked={metadata.enabled}
              onCheckedChange={(enabled) => setMetadata((current) => ({ ...current, enabled }))}
            />
          </div>
          <div className="space-y-3">
            <PolicyTextInput
              label="Website"
              disabled={!metadata.enabled}
              value={metadata.test_website_url ?? ""}
              onChange={(value) =>
                setMetadata((current) => ({
                  ...current,
                  test_website_url: value || null,
                }))
              }
            />
            <PolicyTextInput
              label="X URL"
              disabled={!metadata.enabled}
              value={metadata.test_twitter_url ?? ""}
              onChange={(value) =>
                setMetadata((current) => ({
                  ...current,
                  test_twitter_url: value || null,
                }))
              }
            />
            <PolicyTextInput
              label="Telegram URL"
              disabled={!metadata.enabled}
              value={metadata.test_telegram_url ?? ""}
              onChange={(value) =>
                setMetadata((current) => ({
                  ...current,
                  test_telegram_url: value || null,
                }))
              }
            />
          </div>
          <Button
            type="button"
            className="mt-4 w-full"
            disabled={savingKey === "metadata_testing_policy"}
            onClick={() => onSave("metadata_testing_policy", metadata)}
          >
            {savingKey === "metadata_testing_policy" ? (
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            ) : (
              <Save aria-hidden="true" className="h-4 w-4" />
            )}
            Save metadata
          </Button>
        </div>

        <div className="rounded-md border border-[#d9decf] p-4">
          <div className="mb-4 flex items-center gap-2">
            <Clock3 aria-hidden="true" className="h-5 w-5 text-[#66706b]" />
            <h3 className="text-base font-black">Launch cooldown</h3>
          </div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="text-sm font-bold">One coin per window</span>
            <Switch
              checked={cooldown.enabled}
              onCheckedChange={(enabled) => setCooldown((current) => ({ ...current, enabled }))}
            />
          </div>
          <label className="block text-sm font-bold">
            Duration (minutes)
            <Input
              className="mt-1"
              type="number"
              min={1}
              max={10080}
              step={1}
              value={cooldown.duration_minutes}
              onChange={(event) =>
                setCooldown((current) => ({
                  ...current,
                  duration_minutes: boundedNumber(event.target.value, 60),
                }))
              }
            />
          </label>
          <Button
            type="button"
            className="mt-4 w-full"
            disabled={savingKey === "launch_cooldown_policy"}
            onClick={() => onSave("launch_cooldown_policy", cooldown)}
          >
            {savingKey === "launch_cooldown_policy" ? (
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            ) : (
              <Save aria-hidden="true" className="h-4 w-4" />
            )}
            Save cooldown
          </Button>
        </div>
      </div>
    </section>
  );
}

function GatingRule({
  enabled,
  label,
  onEnabledChange,
  onValueChange,
  value,
}: {
  enabled: boolean;
  label: string;
  onEnabledChange: (enabled: boolean) => void;
  onValueChange: (value: number) => void;
  value: number;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto_7rem] items-center gap-3">
      <span className="text-sm font-bold">{label}</span>
      <Switch checked={enabled} onCheckedChange={onEnabledChange} />
      <Input
        type="number"
        min={0}
        step={1}
        disabled={!enabled}
        value={String(value)}
        onChange={(event) => onValueChange(boundedNumber(event.target.value, value))}
        className="h-10 border-[#cfd7c7]"
      />
    </div>
  );
}

function PolicyTextInput({
  disabled,
  label,
  onChange,
  value,
}: {
  disabled?: boolean;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-bold">{label}</span>
      <Input
        type="url"
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-10 border-[#cfd7c7]"
      />
    </label>
  );
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-[#f6f7f2] p-3">
      <p className="text-xs font-bold uppercase tracking-[0.1em] text-[#66706b]">{label}</p>
      <strong className="mt-1 block break-words text-sm">{value}</strong>
    </div>
  );
}

function BanListItem({
  actionLabel,
  ban,
  loading,
  onAction,
}: {
  actionLabel?: string;
  ban: BanRow;
  loading?: boolean;
  onAction?: () => void;
}) {
  const username = ban.username_at_ban ? `@${ban.username_at_ban}` : ban.x_user_id;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d9decf] p-4 last:border-b-0">
      <div className="flex min-w-0 items-center gap-3">
        {ban.profile_image_url ? (
          <img src={ban.profile_image_url} alt="" className="h-10 w-10 rounded-full object-cover" />
        ) : (
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f6f7f2]">
            <UserX aria-hidden="true" className="h-5 w-5" />
          </span>
        )}
        <div className="min-w-0">
          <strong className="block truncate text-sm">{username}</strong>
          <p className="break-all text-xs text-[#66706b]">{ban.x_user_id}</p>
          <p className="mt-1 text-xs text-[#66706b]">
            {ban.is_active
              ? `Banned ${formatDate(ban.banned_at)}`
              : `Unbanned ${formatDate(ban.unbanned_at)}`}
          </p>
          {ban.reason ? <p className="mt-1 text-xs text-[#66706b]">{ban.reason}</p> : null}
        </div>
      </div>
      {onAction && actionLabel ? (
        <Button type="button" variant="outline" onClick={onAction} disabled={loading}>
          {loading ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
