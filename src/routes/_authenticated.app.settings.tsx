import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleDollarSign, Loader2, Save, ShieldAlert, ShieldCheck, Zap } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/app/settings")({
  head: () => ({ meta: [{ title: "Rules - Linkr" }] }),
  component: Settings,
});

const SharedSchema = z.object({
  default_slippage_percent: z.coerce.number().min(0).max(30),
  max_auto_sell_percent: z.coerce.number().min(0).max(100),
  require_confirmation_for_all_tx: z.boolean(),
});

const EthSchema = z.object({
  max_auto_buy_eth: z.coerce.number().min(0),
  max_auto_transfer_eth: z.coerce.number().min(0),
  max_auto_dev_buy_eth: z.coerce.number().min(0),
  require_confirmation_for_all_tx: z.boolean(),
});

const SolSchema = z.object({
  max_auto_buy_sol: z.coerce.number().min(0),
  max_auto_transfer_sol: z.coerce.number().min(0),
  max_auto_transfer_usdc: z.coerce.number().min(0).max(1_000_000),
  max_auto_dev_buy_sol: z.coerce.number().min(0),
  solana_priority_fee_sol: z.coerce.number().min(0).max(0.01),
  require_confirmation_for_all_tx: z.boolean(),
});

type FormState = z.infer<typeof SharedSchema> &
  z.infer<typeof EthSchema> &
  z.infer<typeof SolSchema>;

type SaveSection = "shared" | "eth" | "sol";

const EMPTY: FormState = {
  default_slippage_percent: 0,
  max_auto_buy_eth: 0,
  max_auto_buy_sol: 0,
  max_auto_sell_percent: 0,
  max_auto_transfer_eth: 0,
  max_auto_transfer_sol: 0,
  max_auto_transfer_usdc: 0,
  max_auto_dev_buy_eth: 0,
  max_auto_dev_buy_sol: 0,
  solana_priority_fee_sol: 0.001,
  require_confirmation_for_all_tx: false,
};

function Settings() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState<SaveSection | null>(null);

  const profileQuery = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    const p = profileQuery.data;
    if (!p) return;
    setForm({
      default_slippage_percent: Number(p.default_slippage_bps ?? 0) / 100,
      max_auto_buy_eth: Number(p.max_auto_buy_eth ?? 0),
      max_auto_buy_sol: Number(p.max_auto_buy_sol ?? 0),
      max_auto_sell_percent: Number(p.max_auto_sell_percent ?? 0),
      max_auto_transfer_eth: Number(p.max_auto_transfer_eth ?? 0),
      max_auto_transfer_sol: Number(p.max_auto_transfer_sol ?? 0),
      max_auto_transfer_usdc: Number(p.max_auto_transfer_usdc ?? 0),
      max_auto_dev_buy_eth: Number(p.max_auto_dev_buy_eth ?? 0),
      max_auto_dev_buy_sol: Number(p.max_auto_dev_buy_sol ?? 0),
      solana_priority_fee_sol: Number(p.solana_priority_fee_lamports ?? 1_000_000) / 1_000_000_000,
      require_confirmation_for_all_tx: Boolean(p.require_confirmation_for_all_tx),
    });
  }, [profileQuery.data]);

  const isLoading = profileQuery.isLoading;

  async function updateRules(
    section: SaveSection,
    payload: Database["public"]["Tables"]["profiles"]["Update"],
    memoryText: string,
  ) {
    if (!user) return;
    setSaving(section);
    const { error } = await supabase.from("profiles").update(payload).eq("user_id", user.id);
    setSaving(null);

    if (error) {
      toast.error(error.message);
      return;
    }

    void supabase.from("user_memory_index").insert({
      user_id: user.id,
      source_type: "settings_update",
      source_id: `${section}:${new Date().toISOString()}`,
      title:
        section === "eth"
          ? "ETH rules updated"
          : section === "sol"
            ? "SOL rules updated"
            : "Shared rules updated",
      searchable_text: memoryText,
      metadata: payload,
    });

    qc.invalidateQueries({ queryKey: ["profile", user.id] });
    qc.invalidateQueries({ queryKey: ["home-dashboard-data"] });
    toast.success(
      section === "eth"
        ? "ETH rules saved"
        : section === "sol"
          ? "Solana rules saved"
          : "Shared rules saved",
    );
  }

  async function saveShared() {
    const parsed = SharedSchema.safeParse({
      default_slippage_percent: form.default_slippage_percent,
      max_auto_sell_percent: form.max_auto_sell_percent,
      require_confirmation_for_all_tx: form.require_confirmation_for_all_tx,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid shared rules");
      return;
    }

    const payload = {
      default_slippage_bps: Math.round(parsed.data.default_slippage_percent * 100),
      max_auto_sell_percent: parsed.data.max_auto_sell_percent,
      require_confirmation_for_all_tx: parsed.data.require_confirmation_for_all_tx,
    };
    await updateRules(
      "shared",
      payload,
      `User updated shared rules: slippage ${parsed.data.default_slippage_percent}%, max sell ${parsed.data.max_auto_sell_percent}%, confirm all ${parsed.data.require_confirmation_for_all_tx ? "yes" : "no"}`,
    );
  }

  async function saveEth() {
    const parsed = EthSchema.safeParse({
      max_auto_buy_eth: form.max_auto_buy_eth,
      max_auto_transfer_eth: form.max_auto_transfer_eth,
      max_auto_dev_buy_eth: form.max_auto_dev_buy_eth,
      require_confirmation_for_all_tx: form.require_confirmation_for_all_tx,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid ETH rules");
      return;
    }

    await updateRules(
      "eth",
      parsed.data,
      `User updated ETH rules: max buy ${parsed.data.max_auto_buy_eth} ETH, max transfer ${parsed.data.max_auto_transfer_eth} ETH, max dev buy ${parsed.data.max_auto_dev_buy_eth} ETH`,
    );
  }

  async function saveSol() {
    const parsed = SolSchema.safeParse({
      max_auto_buy_sol: form.max_auto_buy_sol,
      max_auto_transfer_sol: form.max_auto_transfer_sol,
      max_auto_transfer_usdc: form.max_auto_transfer_usdc,
      max_auto_dev_buy_sol: form.max_auto_dev_buy_sol,
      solana_priority_fee_sol: form.solana_priority_fee_sol,
      require_confirmation_for_all_tx: form.require_confirmation_for_all_tx,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid Solana rules");
      return;
    }

    const payload = {
      max_auto_buy_sol: parsed.data.max_auto_buy_sol,
      max_auto_transfer_sol: parsed.data.max_auto_transfer_sol,
      max_auto_transfer_usdc: parsed.data.max_auto_transfer_usdc,
      max_auto_dev_buy_sol: parsed.data.max_auto_dev_buy_sol,
      solana_priority_fee_lamports: Math.round(parsed.data.solana_priority_fee_sol * 1_000_000_000),
      require_confirmation_for_all_tx: parsed.data.require_confirmation_for_all_tx,
    };
    await updateRules(
      "sol",
      payload,
      `User updated Solana rules: max buy ${parsed.data.max_auto_buy_sol} SOL, max transfer ${parsed.data.max_auto_transfer_sol} SOL, max USDC transfer ${parsed.data.max_auto_transfer_usdc} USDC, max dev buy ${parsed.data.max_auto_dev_buy_sol} SOL, max priority fee ${parsed.data.solana_priority_fee_sol} SOL`,
    );
  }

  return (
    <div className="app-dashboard-page app-rules-page">
      <header className="app-live-hero app-dashboard-hero app-rules-hero">
        <div className="app-dashboard-hero-copy">
          <p className="app-live-kicker">Wallet guardrails</p>
          <h1>Rules</h1>
          <p>
            Set separate limits for Robinhood Chain ETH actions and Solana actions. Shared
            confirmation and slippage rules apply before anything signs.
          </p>
        </div>
        <div className="app-live-signal" aria-label="Rules status">
          <span />
          {form.require_confirmation_for_all_tx ? "confirm all" : "auto within limits"}
        </div>
      </header>

      <div className="app-dashboard-alert app-rules-alert">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <div>
          <div className="font-medium text-foreground">These are per-action limits.</div>
          <p className="mt-1 text-sm text-muted-foreground">
            Set a limit to 0 to disable that action type. Linkr checks these rules again before a
            wallet signs.
          </p>
        </div>
      </div>

      <div className="app-rules-layout">
        <section className="sm-card app-dashboard-card app-rules-card app-rules-card-wide">
          <div className="app-rules-card-head app-dashboard-card-head app-dashboard-section-head">
            <div>
              <h2>
                <ShieldCheck className="h-4 w-4" /> Execution rules
              </h2>
              <p className="app-dashboard-section-copy">
                Shared slippage, sell limits, and confirmation behavior for every chain.
              </p>
            </div>
          </div>
          <div className="app-rules-fields app-rules-fields-two">
            <Field
              label="Default slippage"
              hint="Used for contract-address swaps on supported chains. 0 disables swaps."
              suffix="%"
              value={form.default_slippage_percent}
              onChange={(v) => setForm((f) => ({ ...f, default_slippage_percent: v }))}
              step="0.1"
              max={30}
              disabled={isLoading}
            />
            <Field
              label="Max auto sell"
              hint="Highest token percentage Linkr can sell from one request."
              suffix="%"
              value={form.max_auto_sell_percent}
              onChange={(v) => setForm((f) => ({ ...f, max_auto_sell_percent: v }))}
              step="1"
              max={100}
              disabled={isLoading}
            />
          </div>
          <label className="app-rules-confirmation" htmlFor="confirm-all-transactions">
            <Checkbox
              id="confirm-all-transactions"
              checked={form.require_confirmation_for_all_tx}
              onCheckedChange={(checked) =>
                setForm((f) => ({
                  ...f,
                  require_confirmation_for_all_tx: checked === true,
                }))
              }
              disabled={isLoading}
            />
            <span>
              <strong>Require confirmation for all transactions</strong>
              <small>
                Every wallet action waits for your confirm reply, even when it is under the limit.
              </small>
            </span>
          </label>
          <div className="app-rules-card-actions">
            <SaveButton
              label="Save shared rules"
              loading={saving === "shared"}
              disabled={Boolean(saving) || isLoading}
              onClick={saveShared}
            />
          </div>
        </section>

        <section className="sm-card app-dashboard-card app-rules-card app-rules-chain-card">
          <div className="app-rules-card-head app-dashboard-card-head app-dashboard-section-head">
            <div>
              <h2>
                <CircleDollarSign className="h-4 w-4" /> ETH rules
              </h2>
              <p className="app-dashboard-section-copy">
                Limits for Robinhood Chain buys, transfers, and launch dev buys.
              </p>
            </div>
          </div>
          <div className="app-rules-fields">
            <Field
              label="Max auto buy"
              hint="Max ETH for one contract-address buy."
              suffix="ETH"
              value={form.max_auto_buy_eth}
              onChange={(v) => setForm((f) => ({ ...f, max_auto_buy_eth: v }))}
              step="0.01"
              disabled={isLoading}
            />
            <Field
              label="Max auto transfer"
              hint="Max ETH for one native transfer."
              suffix="ETH"
              value={form.max_auto_transfer_eth}
              onChange={(v) => setForm((f) => ({ ...f, max_auto_transfer_eth: v }))}
              step="0.01"
              disabled={isLoading}
            />
            <Field
              label="Max launch dev buy"
              hint="Max ETH Linkr can use for a Robinhood launch buy."
              suffix="ETH"
              value={form.max_auto_dev_buy_eth}
              onChange={(v) => setForm((f) => ({ ...f, max_auto_dev_buy_eth: v }))}
              step="0.01"
              disabled={isLoading}
            />
          </div>
          <div className="app-rules-card-actions">
            <SaveButton
              label="Save ETH rules"
              loading={saving === "eth"}
              disabled={Boolean(saving) || isLoading}
              onClick={saveEth}
            />
          </div>
        </section>

        <section className="sm-card app-dashboard-card app-rules-card app-rules-chain-card">
          <div className="app-rules-card-head app-dashboard-card-head app-dashboard-section-head">
            <div>
              <h2>
                <Zap className="h-4 w-4" /> SOL rules
              </h2>
              <p className="app-dashboard-section-copy">
                Limits for Solana buys, transfers, and Pump.fun launch dev buys.
              </p>
            </div>
          </div>
          <div className="app-rules-fields">
            <Field
              label="Max auto buy"
              hint="Max SOL for one Solana buy."
              suffix="SOL"
              value={form.max_auto_buy_sol}
              onChange={(v) => setForm((f) => ({ ...f, max_auto_buy_sol: v }))}
              step="0.01"
              disabled={isLoading}
            />
            <Field
              label="Max auto transfer"
              hint="Max SOL for one native Solana transfer."
              suffix="SOL"
              value={form.max_auto_transfer_sol}
              onChange={(v) => setForm((f) => ({ ...f, max_auto_transfer_sol: v }))}
              step="0.01"
              disabled={isLoading}
            />
            <Field
              label="Max USDC transfer"
              hint="Max native Solana USDC for one transfer. Set 0 to disable."
              suffix="USDC"
              value={form.max_auto_transfer_usdc}
              onChange={(v) => setForm((f) => ({ ...f, max_auto_transfer_usdc: v }))}
              step="1"
              disabled={isLoading}
            />
            <Field
              label="Max swap priority fee"
              hint="Maximum Solana priority fee Jupiter may add to one swap."
              suffix="SOL"
              value={form.solana_priority_fee_sol}
              onChange={(v) => setForm((f) => ({ ...f, solana_priority_fee_sol: v }))}
              step="0.0001"
              max={0.01}
              disabled={isLoading}
            />
            <Field
              label="Max launch dev buy"
              hint="Max SOL Linkr can use for a Pump.fun launch buy."
              suffix="SOL"
              value={form.max_auto_dev_buy_sol}
              onChange={(v) => setForm((f) => ({ ...f, max_auto_dev_buy_sol: v }))}
              step="0.01"
              disabled={isLoading}
            />
          </div>
          <div className="app-rules-card-actions">
            <SaveButton
              label="Save SOL rules"
              loading={saving === "sol"}
              disabled={Boolean(saving) || isLoading}
              onClick={saveSol}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function SaveButton({
  label,
  loading,
  disabled,
  onClick,
}: {
  label: string;
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button onClick={onClick} disabled={disabled} className="app-rules-save-button gap-2">
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
      {label}
    </Button>
  );
}

function Field({
  label,
  hint,
  suffix,
  value,
  onChange,
  step,
  max,
  disabled,
}: {
  label: string;
  hint: string;
  suffix: string;
  value: number;
  onChange: (v: number) => void;
  step?: string;
  max?: number;
  disabled?: boolean;
}) {
  return (
    <div className="app-rules-field">
      <div className="app-rules-field-copy">
        <Label className="app-rules-label">{label}</Label>
        <p>{hint}</p>
      </div>
      <div className="app-rules-input-wrap">
        <Input
          type="number"
          step={step ?? "0.01"}
          min={0}
          max={max}
          value={Number.isFinite(value) ? value : ""}
          onChange={(e) => onChange(Number(e.target.value))}
          disabled={disabled}
          className="sm-mono app-rules-input"
        />
        <span>{suffix}</span>
      </div>
    </div>
  );
}
