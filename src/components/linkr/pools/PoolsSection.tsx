import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Coins, Droplets, Loader2, Plus, RefreshCw, Wallet } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DashboardStatCard } from "@/components/linkr/DashboardStatCard";
import { PoolsRiskWarning } from "@/components/linkr/pools/PoolsRiskWarning";
import { supabase } from "@/integrations/supabase/client";
import { useLiquidityPositions, type LiquidityPosition } from "@/hooks/use-liquidity-positions";
import { shortAddress } from "@/lib/linkr/format";

type PendingExecution = {
  action: {
    id: string;
  };
  confirmation_text?: string;
};

const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const SOLANA_ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function PoolsSection({ userId }: { userId?: string }) {
  const query = useLiquidityPositions(userId);
  const [addOpen, setAddOpen] = useState(false);
  const [pumpAddOpen, setPumpAddOpen] = useState(false);
  const [removePosition, setRemovePosition] = useState<LiquidityPosition | null>(null);
  const positions = query.data?.positions ?? [];
  const robinhoodPositions = positions.filter((position) => position.chain !== "solana");
  const pumpPositions = positions.filter((position) => position.chain === "solana");
  const summary = query.data?.summary;

  return (
    <section className="sm-card app-dashboard-card app-pools-section">
      <div className="app-dashboard-card-head">
        <div>
          <h2>
            <Droplets aria-hidden="true" className="h-4 w-4 text-primary" />
            Pools
          </h2>
          <p className="app-pools-section-copy">
            Manage optional LP positions for tokens launched on Linkr.
          </p>
        </div>
        <div className="app-pools-actions">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
          >
            {query.isFetching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {query.isFetching ? "Refreshing" : "Refresh"}
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)} className="gap-1">
            <Plus className="h-4 w-4" />
            Add ETH LP
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPumpAddOpen(true)}
            className="gap-1"
          >
            <Coins className="h-4 w-4" />
            Add Pump LP
          </Button>
        </div>
      </div>

      <PoolsRiskWarning />

      <div className="app-dashboard-launch-stats" role="group" aria-label="Pool stats">
        <PoolMetric label="Robinhood LP" value={String(summary?.robinhoodActiveCount ?? 0)} />
        <PoolMetric label="PumpSwap LP" value={String(summary?.solanaActiveCount ?? 0)} />
        <PoolMetric
          label="Estimated value"
          value={summary?.totalValueUsd ? `$${summary.totalValueUsd.toLocaleString()}` : "n/a"}
        />
        <PoolMetric
          label="Uncollected fees"
          value={
            summary?.uncollectedFeesUsd ? `$${summary.uncollectedFeesUsd.toLocaleString()}` : "n/a"
          }
        />
      </div>

      <div className="app-pools-list">
        <div className="app-pools-subsection-head">
          <div>
            <h3>Robinhood Chain ETH pools</h3>
            <p>Uniswap V3 positions for Linkr-launched Robinhood Chain tokens.</p>
          </div>
        </div>
        {query.isLoading && <div className="app-dashboard-empty">Loading LP positions...</div>}
        {!query.isLoading && robinhoodPositions.length === 0 && (
          <div className="app-dashboard-empty">
            <Wallet className="h-8 w-8 opacity-40" />
            <div>No Robinhood Chain LP positions yet.</div>
            <Button size="sm" onClick={() => setAddOpen(true)} className="mt-2">
              Add ETH LP
            </Button>
          </div>
        )}
        {robinhoodPositions.map((position) => (
          <PoolPositionCard
            key={position.id}
            position={position}
            onRemove={() => setRemovePosition(position)}
          />
        ))}
      </div>

      <div className="app-pools-list">
        <div className="app-pools-subsection-head">
          <div>
            <h3>Pump.fun PumpSwap pools</h3>
            <p>
              Add or remove token/SOL liquidity for graduated Pump.fun tokens with an existing
              PumpSwap pool.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPumpAddOpen(true)}
            className="gap-1"
          >
            <Plus className="h-4 w-4" />
            Add Pump LP
          </Button>
        </div>
        {!query.isLoading && pumpPositions.length === 0 && (
          <div className="app-dashboard-empty">
            <Coins className="h-8 w-8 opacity-40" />
            <div>No PumpSwap LP positions yet.</div>
          </div>
        )}
        {pumpPositions.map((position) => (
          <PoolPositionCard
            key={position.id}
            position={position}
            onRemove={() => setRemovePosition(position)}
          />
        ))}
      </div>

      <AddLiquidityDialog open={addOpen} onOpenChange={setAddOpen} />
      <PumpAddLiquidityDialog open={pumpAddOpen} onOpenChange={setPumpAddOpen} />
      <RemoveLiquidityDialog
        position={removePosition}
        onOpenChange={(open) => !open && setRemovePosition(null)}
      />
    </section>
  );
}

function PoolMetric({ label, value }: { label: string; value: string }) {
  return <DashboardStatCard label={label} value={value} />;
}

function PoolPositionCard({
  position,
  onRemove,
}: {
  position: LiquidityPosition;
  onRemove: () => void;
}) {
  const collect = useLiquidityCollectMutation();
  const isPump = position.chain === "solana";
  const poolUrl = isPump
    ? `https://solscan.io/account/${position.pool_address}`
    : `https://robinhoodchain.blockscout.com/address/${position.pool_address}`;
  return (
    <div className="app-pools-position">
      <div className="app-pools-position-main">
        <div>
          <div className="app-pools-position-head">
            <h3>{position.token_symbol ?? "LP position"}</h3>
            <span className="app-pools-position-chip">
              {isPump ? "PumpSwap / SOL" : "Robinhood / ETH"}
            </span>
            <span className="app-pools-position-chip">
              #{shortAddress(position.position_token_id)}
            </span>
            <span className="app-pools-position-chip app-pools-position-chip-active">
              {position.in_range === false ? "out of range" : "active"}
            </span>
          </div>
          <div className="app-pools-position-addresses">
            {shortAddress(position.token_address)} / pool {shortAddress(position.pool_address)}
            {!isPump && ` / ${(position.pool_fee / 10_000).toFixed(2).replace(/\.?0+$/, "")}% fee`}
          </div>
          <div className="app-pools-position-stats">
            {!isPump && (
              <span>
                Range: {position.tick_lower} to {position.tick_upper}
              </span>
            )}
            <span>Liquidity: {position.liquidity}</span>
            {isPump ? (
              <span>LP token account: {shortAddress(position.position_token_id)}</span>
            ) : (
              <span>Fees: {formatWei(position.uncollected_weth_fees_wei)} ETH</span>
            )}
          </div>
        </div>
        <div className="app-pools-position-actions">
          <Button size="sm" variant="outline" onClick={onRemove}>
            Remove
          </Button>
          {!isPump && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => collect.mutate(position)}
              disabled={collect.isPending}
              className="gap-2"
            >
              {collect.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {collect.isPending ? "Collecting" : "Collect fees"}
            </Button>
          )}
          <Button asChild size="sm" variant="ghost" className="gap-1">
            <a href={poolUrl} target="_blank" rel="noreferrer">
              View <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}

function AddLiquidityDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [token, setToken] = useState("");
  const [ethAmount, setEthAmount] = useState("");
  const [tokenAmount, setTokenAmount] = useState("");
  const [ack, setAck] = useState(false);
  const mutation = useLiquidityCreateAndExecuteMutation("add");
  const tokenAddress = token.trim();
  const tokenAddressValid = EVM_ADDRESS_PATTERN.test(tokenAddress);
  const canSubmit = tokenAddressValid && Number(ethAmount) > 0 && ack && !mutation.isPending;

  function submit() {
    if (!tokenAddressValid) {
      toast.error("Enter the full token contract address.");
      return;
    }
    mutation.mutate(
      {
        token: tokenAddress,
        ethAmount,
        tokenAmount: tokenAmount || null,
        risk_acknowledged: ack,
      },
      {
        onSuccess: () => {
          setToken("");
          setEthAmount("");
          setTokenAmount("");
          setAck(false);
          onOpenChange(false);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="app-dashboard-modal app-pools-dialog">
        <DialogHeader className="app-dashboard-modal-header">
          <DialogTitle>Add liquidity</DialogTitle>
          <DialogDescription>
            Add optional user-owned liquidity to an existing Linkr-launched V3 pool.
          </DialogDescription>
        </DialogHeader>
        <div className="app-pools-dialog-body">
          <Field
            label="Token contract address"
            value={token}
            onChange={setToken}
            placeholder="0x..."
          />
          {token && !tokenAddressValid && (
            <p className="app-pools-field-error">Use the full 0x token contract address.</p>
          )}
          <Field label="ETH amount" value={ethAmount} onChange={setEthAmount} placeholder="0.2" />
          <Field
            label="Token amount optional"
            value={tokenAmount}
            onChange={setTokenAmount}
            placeholder="Auto-estimate"
          />
          <PoolsRiskWarning />
          <label className="app-pools-ack">
            <Checkbox checked={ack} onCheckedChange={(v) => setAck(Boolean(v))} />
            <span>
              I understand LP positions can lose value and I should only provide liquidity I can
              afford to lose.
            </span>
          </label>
        </div>
        <DialogFooter className="app-dashboard-modal-footer app-pools-dialog-footer">
          <Button
            className="app-pools-dialog-secondary"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button className="app-pools-dialog-primary" onClick={submit} disabled={!canSubmit}>
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {mutation.isPending ? "Confirming" : "Confirm add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PumpAddLiquidityDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [mint, setMint] = useState("");
  const [tokenAmount, setTokenAmount] = useState("");
  const [ack, setAck] = useState(false);
  const mutation = useLiquidityCreateAndExecuteMutation("add");
  const mintAddress = mint.trim();
  const mintValid = SOLANA_ADDRESS_PATTERN.test(mintAddress);
  const canSubmit = mintValid && Number(tokenAmount) > 0 && ack && !mutation.isPending;

  function submit() {
    if (!mintValid) {
      toast.error("Enter the full Pump.fun token mint.");
      return;
    }
    mutation.mutate(
      {
        chain: "solana",
        platform: "pump_swap",
        token_mint: mintAddress,
        tokenAmount,
        risk_acknowledged: ack,
      },
      {
        onSuccess: () => {
          setMint("");
          setTokenAmount("");
          setAck(false);
          onOpenChange(false);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="app-dashboard-modal app-pools-dialog">
        <DialogHeader className="app-dashboard-modal-header">
          <DialogTitle>Add PumpSwap liquidity</DialogTitle>
          <DialogDescription>
            Add token/SOL liquidity to an existing PumpSwap pool for a graduated Pump.fun token.
          </DialogDescription>
        </DialogHeader>
        <div className="app-pools-dialog-body">
          <Field
            label="Pump.fun token mint"
            value={mint}
            onChange={setMint}
            placeholder="Base58 mint"
          />
          {mint && !mintValid && (
            <p className="app-pools-field-error">Use the full Solana mint address.</p>
          )}
          <Field
            label="Pump token amount"
            value={tokenAmount}
            onChange={setTokenAmount}
            placeholder="100000"
          />
          <p className="app-pools-helper">
            PumpSwap calculates the matching SOL amount from the current pool ratio before signing.
          </p>
          <PoolsRiskWarning />
          <label className="app-pools-ack">
            <Checkbox checked={ack} onCheckedChange={(v) => setAck(Boolean(v))} />
            <span>
              I understand PumpSwap LP tokens represent token/SOL exposure and can lose value.
            </span>
          </label>
        </div>
        <DialogFooter className="app-dashboard-modal-footer app-pools-dialog-footer">
          <Button
            className="app-pools-dialog-secondary"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button className="app-pools-dialog-primary" onClick={submit} disabled={!canSubmit}>
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {mutation.isPending ? "Confirming" : "Confirm add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RemoveLiquidityDialog({
  position,
  onOpenChange,
}: {
  position: LiquidityPosition | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [percent, setPercent] = useState("50");
  const [ack, setAck] = useState(false);
  const mutation = useLiquidityCreateAndExecuteMutation("remove");
  const canSubmit = position && Number(percent) > 0 && ack && !mutation.isPending;

  function submit() {
    if (!position) return;
    mutation.mutate(
      {
        position_id: position.id,
        chain: position.chain === "solana" ? "solana" : "robinhood",
        platform: position.chain === "solana" ? "pump_swap" : "robinhood_uniswap_v3",
        percent,
        risk_acknowledged: ack,
      },
      {
        onSuccess: () => {
          setPercent("50");
          setAck(false);
          onOpenChange(false);
        },
      },
    );
  }

  return (
    <Dialog open={!!position} onOpenChange={onOpenChange}>
      <DialogContent className="app-dashboard-modal app-pools-dialog">
        <DialogHeader className="app-dashboard-modal-header">
          <DialogTitle>Remove liquidity</DialogTitle>
          <DialogDescription>
            Remove liquidity from {position?.token_symbol ?? "this"}{" "}
            {position?.chain === "solana" ? "PumpSwap" : "Robinhood Chain"} position #
            {position ? shortAddress(position.position_token_id) : ""}.
          </DialogDescription>
        </DialogHeader>
        <div className="app-pools-dialog-body">
          <div className="app-pools-percent-grid">
            {["25", "50", "75", "100"].map((value) => (
              <Button
                key={value}
                className="app-pools-percent-option"
                variant={percent === value ? "default" : "outline"}
                onClick={() => setPercent(value)}
              >
                {value}%
              </Button>
            ))}
          </div>
          <Field label="Custom percent" value={percent} onChange={setPercent} placeholder="50" />
          <PoolsRiskWarning />
          <label className="app-pools-ack">
            <Checkbox checked={ack} onCheckedChange={(v) => setAck(Boolean(v))} />
            <span>
              I understand removing LP changes my market exposure and collected amounts can vary.
            </span>
          </label>
        </div>
        <DialogFooter className="app-dashboard-modal-footer app-pools-dialog-footer">
          <Button
            className="app-pools-dialog-secondary"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button className="app-pools-dialog-primary" onClick={submit} disabled={!canSubmit}>
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {mutation.isPending ? "Confirming" : "Confirm remove"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const id = useMemo(() => label.toLowerCase().replace(/[^a-z0-9]+/g, "-"), [label]);
  return (
    <div className="app-pools-field">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

function useLiquidityCollectMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (position: LiquidityPosition) => {
      const created = await invokeLiquidityAction("create-remove-liquidity-action", {
        action: "collect_liquidity_fees",
        position_id: position.id,
        risk_acknowledged: true,
      });
      return executeLiquidityAction(created.action.id);
    },
    onSuccess: () => {
      toast.success("Fees collected");
      queryClient.invalidateQueries({ queryKey: ["liquidity-positions"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not collect fees"),
  });
}

function useLiquidityCreateAndExecuteMutation(kind: "add" | "remove") {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const fn = kind === "add" ? "create-add-liquidity-action" : "create-remove-liquidity-action";
      const created = await invokeLiquidityAction(fn, body);
      return executeLiquidityAction(created.action.id);
    },
    onSuccess: () => {
      toast.success(kind === "add" ? "Liquidity added" : "Liquidity removed");
      queryClient.invalidateQueries({ queryKey: ["liquidity-positions"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Liquidity action failed"),
  });
}

async function invokeLiquidityAction(
  fn: string,
  body: Record<string, unknown>,
): Promise<PendingExecution> {
  const { data, error } = await supabase.functions.invoke<PendingExecution>(fn, { body });
  if (error) throw error;
  if (!data?.action?.id) throw new Error("Liquidity action was not created");
  return data;
}

async function executeLiquidityAction(actionId: string) {
  const { data, error } = await supabase.functions.invoke("execute-liquidity-action", {
    body: { action_id: actionId },
  });
  if (error) throw error;
  return data;
}

function formatWei(value: string | null) {
  if (!value) return "0";
  const number = Number(value) / 1e18;
  if (!Number.isFinite(number) || number === 0) return "0";
  if (number < 0.000001) return "<0.000001";
  return number.toLocaleString("en-US", { maximumFractionDigits: 6 });
}
