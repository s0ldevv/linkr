import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Loader2,
  Plus,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/app/api-keys")({
  head: () => ({ meta: [{ title: "Agents - Linkr" }] }),
  component: AgentsPage,
});

type AgentProfile = {
  id: string;
  name: string;
  status: string;
  wallet_id: string | null;
  public_contact: string | null;
  created_at: string;
};

type AgentKey = {
  id: string;
  agent_profile_id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  status: string;
  last_used_at: string | null;
  created_at: string;
};

type AgentAction = {
  id: string;
  created_at: string;
  agent_profile_id: string | null;
  api_key_id: string | null;
  method: string;
  path: string;
  idempotency_key: string | null;
  status_code: number | null;
  error_code: string | null;
  error_message: string | null;
  duration_ms: number | null;
  user_agent: string | null;
};

type CreateAgentResponse = {
  api_key?: string;
};

type CreateOnboardingResponse = {
  token?: string;
};

function AgentsPage() {
  const qc = useQueryClient();
  const [agentName, setAgentName] = useState("Trading Agent");
  const [contact, setContact] = useState("");
  const [plainSecret, setPlainSecret] = useState<string | null>(null);
  const [onboardingToken, setOnboardingToken] = useState<string | null>(null);
  const [secretCopied, setSecretCopied] = useState(false);
  const [enableBurnScope, setEnableBurnScope] = useState(false);

  const query = useQuery({
    queryKey: ["agent-api-keys"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke<{
        profiles: AgentProfile[];
        keys: AgentKey[];
        actions: AgentAction[];
      }>("agent-api-keys", { method: "GET" });
      if (error) throw error;
      return data ?? { profiles: [], keys: [], actions: [] };
    },
  });

  const createAgent = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("agent-api-keys", {
        body: {
          action: "create_agent",
          agent_name: agentName,
          public_contact: contact,
          requested_scopes: [
            "profile:read",
            "actions:read",
            "coins:read",
            "coin:read",
            "launch:write",
            "trade:buy",
            "trade:sell",
            "transfer:write",
            "liquidity:write",
            "rewards:claim",
            ...(enableBurnScope ? ["burn:write"] : []),
          ],
          limits: {
            max_buy_eth: 0.01,
            max_buy_sol: 0.05,
            max_sell_percent: 25,
            max_transfer_eth: 0,
            max_transfer_sol: 0,
            max_launch_initial_buy_eth: 0.01,
            max_liquidity_eth: 0.01,
          },
        },
      });
      if (error) throw error;
      return data as CreateAgentResponse | null;
    },
    onSuccess: (data) => {
      setPlainSecret(data?.api_key ?? null);
      qc.invalidateQueries({ queryKey: ["agent-api-keys"] });
      toast.success("Agent profile created");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  });

  const createOnboarding = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("agent-onboarding-tokens", {
        body: {
          name: "External agent onboarding",
          requested_scopes: ["profile:read", "coins:read", "coin:read"],
          ttl_minutes: 60,
        },
      });
      if (error) throw error;
      return data as CreateOnboardingResponse | null;
    },
    onSuccess: (data) => {
      setOnboardingToken(data?.token ?? null);
      toast.success("Onboarding token created");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  });

  const actionMutation = useMutation({
    mutationFn: async (body: Record<string, unknown> & { action: string }) => {
      const { data, error } = await supabase.functions.invoke("agent-api-keys", { body });
      if (error) throw error;
      return { data, action: body.action };
    },
    onSuccess: ({ action }) => {
      qc.invalidateQueries({ queryKey: ["agent-api-keys"] });
      toast.success(action === "revoke_key" ? "API key revoked" : "Agent disabled");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  });

  const profiles = query.data?.profiles ?? [];
  const keys = query.data?.keys ?? [];
  const actions = query.data?.actions ?? [];
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const keyById = new Map(keys.map((key) => [key.id, key]));
  const secretValue = plainSecret ?? onboardingToken;

  async function copySecret() {
    if (!secretValue) return;
    try {
      await navigator.clipboard.writeText(secretValue);
      setSecretCopied(true);
      window.setTimeout(() => setSecretCopied(false), 1400);
      toast.success("Copied");
    } catch {
      toast.error("Copy failed");
    }
  }

  return (
    <div className="app-dashboard-page app-api-keys-page">
      <header className="app-live-hero app-dashboard-hero">
        <div className="app-dashboard-hero-copy">
          <p className="app-live-kicker">Agent access</p>
          <h1>Agents</h1>
          <p>
            Create scoped agent profiles, issue signed API keys, review linked wallets, and monitor
            every external runtime bound to your Linkr account.
          </p>
        </div>
        <div className="app-agents-hero-actions">
          <a
            className="app-agents-docs-link"
            href="https://www.linkr.cash/agent-api"
            target="_blank"
            rel="noreferrer"
          >
            Agent docs
            <ExternalLink aria-hidden="true" size={16} />
          </a>
          <div className="app-live-signal" aria-label="API status">
            <KeyRound aria-hidden="true" size={16} />
            signed requests
          </div>
        </div>
      </header>

      <div className="app-dashboard-grid app-dashboard-grid-primary">
        <section className="sm-card app-dashboard-card">
          <div className="app-dashboard-card-head">
            <div className="app-dashboard-card-title">
              <ShieldCheck aria-hidden="true" size={18} />
              New agent profile
            </div>
          </div>
          <div className="app-api-form-grid">
            <div>
              <Label>Agent name</Label>
              <Input value={agentName} onChange={(event) => setAgentName(event.target.value)} />
            </div>
            <div>
              <Label>Contact</Label>
              <Input value={contact} onChange={(event) => setContact(event.target.value)} />
            </div>
          </div>
          <label
            className="app-dashboard-hint"
            style={{ display: "flex", gap: 10, alignItems: "flex-start" }}
          >
            <input
              type="checkbox"
              checked={enableBurnScope}
              onChange={(event) => setEnableBurnScope(event.target.checked)}
            />
            <span>
              Enable <code>burn:write</code>. Token burns are irreversible and always require a
              separate confirmation request.
            </span>
          </label>
          <Button onClick={() => createAgent.mutate()} disabled={createAgent.isPending}>
            {createAgent.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Create agent and key
          </Button>
        </section>

        <section className="sm-card app-dashboard-card">
          <div className="app-dashboard-card-head">
            <div className="app-dashboard-card-title">One-time onboarding</div>
          </div>
          <p className="app-dashboard-hint">
            Use this when an external AI runtime needs to register itself once.
          </p>
          <Button onClick={() => createOnboarding.mutate()} disabled={createOnboarding.isPending}>
            {createOnboarding.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <KeyRound className="h-4 w-4" />
            )}
            Create onboarding token
          </Button>
        </section>
      </div>

      {secretValue && (
        <section className="sm-card app-dashboard-card app-api-secret-card">
          <div className="app-dashboard-card-title">One-time secret</div>
          <div className="app-copy-value-box">
            <code>{secretValue}</code>
            <button
              type="button"
              className="app-address-copy-button"
              aria-label="Copy API secret"
              data-copied={secretCopied}
              onClick={copySecret}
            >
              {secretCopied ? (
                <Check aria-hidden="true" className="h-4 w-4" />
              ) : (
                <Copy aria-hidden="true" className="h-4 w-4" />
              )}
            </button>
          </div>
        </section>
      )}

      <div className="app-dashboard-grid app-dashboard-grid-secondary">
        <section className="sm-card app-dashboard-card">
          <div className="app-dashboard-card-title">Agent profiles</div>
          <div className="app-dashboard-activity-list">
            {query.isLoading && <div className="app-dashboard-empty">Loading agents...</div>}
            {profiles.map((profile) => (
              <div className="app-dashboard-activity-row" key={profile.id}>
                <div>
                  <strong>{profile.name}</strong>
                  <p>
                    {profile.status} - wallet {profile.wallet_id?.slice(0, 8) ?? "pending"}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  disabled={profile.status === "disabled" || actionMutation.isPending}
                  onClick={() =>
                    actionMutation.mutate({
                      action: "disable_profile",
                      agent_profile_id: profile.id,
                    })
                  }
                >
                  <XCircle className="h-4 w-4" />
                  {profile.status === "disabled" ? "Disabled" : "Disable"}
                </Button>
              </div>
            ))}
            {!query.isLoading && profiles.length === 0 && (
              <div className="app-dashboard-empty">No agent profiles yet.</div>
            )}
          </div>
        </section>

        <section className="sm-card app-dashboard-card">
          <div className="app-dashboard-card-title">Keys</div>
          <div className="app-dashboard-activity-list">
            {keys.map((key) => (
              <div className="app-dashboard-activity-row" key={key.id}>
                <div>
                  <strong>{key.name}</strong>
                  <p>
                    {key.status} - {key.key_prefix} - {key.scopes?.length ?? 0} scopes
                  </p>
                </div>
                <Button
                  variant="ghost"
                  disabled={key.status === "revoked" || actionMutation.isPending}
                  onClick={() => actionMutation.mutate({ action: "revoke_key", key_id: key.id })}
                >
                  {key.status === "revoked" ? "Revoked" : "Revoke"}
                </Button>
              </div>
            ))}
            {!query.isLoading && keys.length === 0 && (
              <div className="app-dashboard-empty">No API keys yet.</div>
            )}
          </div>
        </section>
      </div>

      {profiles.length > 0 && (
        <section className="sm-card app-dashboard-card">
          <div className="app-dashboard-card-head">
            <div className="app-dashboard-card-title">
              <Activity aria-hidden="true" size={18} />
              Agent actions
            </div>
          </div>
          <div className="app-dashboard-activity-list">
            {actions.map((action) => {
              const profile = action.agent_profile_id
                ? profileById.get(action.agent_profile_id)
                : null;
              const key = action.api_key_id ? keyById.get(action.api_key_id) : null;
              const ok =
                action.status_code != null &&
                action.status_code >= 200 &&
                action.status_code < 400 &&
                !action.error_code;
              return (
                <div className="app-dashboard-activity-row app-agent-action-row" key={action.id}>
                  <div>
                    <strong>
                      {action.method} {action.path}
                    </strong>
                    <p>
                      {profile?.name ?? "Agent"} - key {key?.key_prefix ?? "unknown"} -{" "}
                      {formatDate(action.created_at)}
                    </p>
                    {action.error_code && (
                      <p className="app-agent-action-error">
                        {action.error_code}
                        {action.error_message ? `: ${action.error_message}` : ""}
                      </p>
                    )}
                  </div>
                  <span className={ok ? "app-agent-action-status-ok" : "app-agent-action-status"}>
                    {action.status_code ?? "pending"}
                  </span>
                </div>
              );
            })}
            {!query.isLoading && actions.length === 0 && (
              <div className="app-dashboard-empty">No agent actions yet.</div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}
