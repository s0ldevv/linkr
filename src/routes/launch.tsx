import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type ChangeEvent, type CSSProperties, type FormEvent } from "react";
import { AlertCircle, Check, ExternalLink, ImagePlus, Loader2, Rocket, Wallet } from "lucide-react";
import { toast } from "sonner";
import { MarketingHeader } from "@/components/linkr/MarketingHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { formatEth, shortAddress } from "@/lib/linkr/format";

type LaunchChain = "robinhood" | "solana";
type LaunchMode = LaunchChain | "dual";
type SolanaRewardMode = "creator" | "cashback";
type ChainLaunchConfig = {
  devBuy: string;
  rewardMode?: SolanaRewardMode;
  rewardRecipient: string;
  rewardShareBps: number;
  rewardShareEnabled: boolean;
  walletId: string;
};

type LaunchWallet = {
  id: string;
  chain: LaunchChain;
  public_key: string;
  address: string;
  is_primary: boolean;
  explorer_url: string | null;
  native_symbol: "ETH" | "SOL";
  balance: { native?: number | null } | null;
};

type LauncherContext = {
  wallets: LaunchWallet[];
  limits: Record<
    LaunchChain,
    { name_max: number; symbol_max: number; native_symbol: "ETH" | "SOL" }
  >;
};

type LaunchResponse = {
  id?: string;
  status?: string;
  chain?: LaunchChain;
  mint?: string | null;
  token_address?: string | null;
  error?: string;
};

type LaunchBatchResponse = LaunchResponse & {
  batch_id?: string;
  results?: LaunchResponse[];
};

const DEFAULT_LIMITS: LauncherContext["limits"] = {
  robinhood: { name_max: 60, symbol_max: 20, native_symbol: "ETH" },
  solana: { name_max: 32, symbol_max: 10, native_symbol: "SOL" },
};

const CHAIN_COPY: Record<
  LaunchChain,
  { title: string; subtitle: string; platform: string; devBuyPlaceholder: string }
> = {
  robinhood: {
    title: "Robinhood Chain",
    subtitle: "Single-sided LP launch, ETH dev buy, LaunchLocker creator rewards.",
    platform: "Robinhood single-sided LP",
    devBuyPlaceholder: "0.05",
  },
  solana: {
    title: "Solana",
    subtitle: "Pump.fun create flow through the Linkr Pump SDK worker.",
    platform: "Pump.fun",
    devBuyPlaceholder: "0.10",
  },
};

const LAUNCH_MODES: Array<{
  value: LaunchMode;
  title: string;
  subtitle: string;
}> = [
  {
    value: "robinhood",
    title: "Robinhood Chain",
    subtitle: "ETH",
  },
  {
    value: "dual",
    title: "Both chains",
    subtitle: "ETH + SOL",
  },
  {
    value: "solana",
    title: "Solana",
    subtitle: "SOL",
  },
];

const DEFAULT_CHAIN_CONFIG: Record<LaunchChain, ChainLaunchConfig> = {
  robinhood: {
    devBuy: "",
    rewardRecipient: "",
    rewardShareBps: 0,
    rewardShareEnabled: false,
    walletId: "",
  },
  solana: {
    devBuy: "",
    rewardMode: "creator",
    rewardRecipient: "",
    rewardShareBps: 2_500,
    rewardShareEnabled: false,
    walletId: "",
  },
};

const LAUNCH_CHAIN_ICON_SRC: Record<LaunchChain, string> = {
  robinhood: "/linkr/chains/evm.png",
  solana: "/linkr/chains/sol.png",
};
const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const X_HANDLE_RE = /^@?[a-zA-Z0-9_]{1,15}$/;

export const Route = createFileRoute("/launch")({
  head: () => ({
    meta: [
      { title: "Launch a Coin - Linkr" },
      {
        name: "description",
        content: "Launch Robinhood Chain or Solana coins from the Linkr web launcher.",
      },
    ],
  }),
  component: LaunchPage,
});

function LaunchPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [launchMode, setLaunchMode] = useState<LaunchMode>("robinhood");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");
  const [chainConfig, setChainConfig] =
    useState<Record<LaunchChain, ChainLaunchConfig>>(DEFAULT_CHAIN_CONFIG);
  const [imageDataUrl, setImageDataUrl] = useState("");
  const [imageName, setImageName] = useState("");

  const contextQuery = useQuery({
    queryKey: ["web-launch-context", user?.id],
    enabled: Boolean(user),
    refetchInterval: 30_000,
    queryFn: async (): Promise<LauncherContext> => {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/web-launch-token`,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        },
      );
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error ?? "Launcher context failed");
      return json as LauncherContext;
    },
  });

  const limits = contextQuery.data?.limits ?? DEFAULT_LIMITS;
  const selectedChains = useMemo<LaunchChain[]>(
    () => (launchMode === "dual" ? ["robinhood", "solana"] : [launchMode]),
    [launchMode],
  );
  const strictLimits = useMemo(
    () => ({
      name_max: Math.min(
        ...selectedChains.map((value) => limits[value]?.name_max ?? DEFAULT_LIMITS[value].name_max),
      ),
      symbol_max: Math.min(
        ...selectedChains.map(
          (value) => limits[value]?.symbol_max ?? DEFAULT_LIMITS[value].symbol_max,
        ),
      ),
    }),
    [limits, selectedChains],
  );
  const walletsByChain = useMemo(
    () => ({
      robinhood: (contextQuery.data?.wallets ?? []).filter(
        (wallet) => wallet.chain === "robinhood",
      ),
      solana: (contextQuery.data?.wallets ?? []).filter((wallet) => wallet.chain === "solana"),
    }),
    [contextQuery.data?.wallets],
  );
  const selectedWallets = useMemo(
    () => ({
      robinhood:
        walletsByChain.robinhood.find((wallet) => wallet.id === chainConfig.robinhood.walletId) ??
        walletsByChain.robinhood.find((wallet) => wallet.is_primary) ??
        walletsByChain.robinhood[0] ??
        null,
      solana:
        walletsByChain.solana.find((wallet) => wallet.id === chainConfig.solana.walletId) ??
        walletsByChain.solana.find((wallet) => wallet.is_primary) ??
        walletsByChain.solana[0] ??
        null,
    }),
    [chainConfig.robinhood.walletId, chainConfig.solana.walletId, walletsByChain],
  );
  const activeWallets = selectedChains
    .map((value) => selectedWallets[value])
    .filter((wallet): wallet is LaunchWallet => Boolean(wallet));
  const reviewChainLabel = selectedChains.map((value) => CHAIN_COPY[value].title).join(" + ");
  const reviewWalletLabel =
    activeWallets.length > 0
      ? activeWallets.map((wallet) => shortAddress(wallet.address, 5, 5)).join(" + ")
      : user
        ? "Select wallet"
        : "Login required";
  const reviewRewardLabel = selectedChains
    .map((value) => rewardReviewLabel(value, chainConfig[value]))
    .join(" + ");

  const launchMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("login_required");
      for (const value of selectedChains) {
        if (!selectedWallets[value]) throw new Error(`Select a ${CHAIN_COPY[value].title} wallet`);
      }
      const idempotencyKey = crypto.randomUUID();
      const body = {
        description: description.trim(),
        idempotency_key: idempotencyKey,
        image_data_url: imageDataUrl,
        launches: selectedChains.map((value) => ({
          chain: value,
          creator_reward_recipient:
            value === "robinhood"
              ? cleanOptional(chainConfig[value].rewardRecipient)
              : chainConfig[value].rewardMode === "creator" && chainConfig[value].rewardShareEnabled
                ? cleanOptional(chainConfig[value].rewardRecipient)
                : undefined,
          creator_reward_share_bps:
            value === "solana" &&
            chainConfig[value].rewardMode === "creator" &&
            chainConfig[value].rewardShareEnabled
              ? chainConfig[value].rewardShareBps
              : undefined,
          dev_buy_eth: value === "robinhood" ? chainConfig[value].devBuy || "0" : undefined,
          dev_buy_sol: value === "solana" ? chainConfig[value].devBuy || "0" : undefined,
          pump_cashback:
            value === "solana" ? chainConfig[value].rewardMode === "cashback" : undefined,
          pump_fee_share_enabled:
            value === "solana"
              ? chainConfig[value].rewardMode === "creator" && chainConfig[value].rewardShareEnabled
              : undefined,
          pump_reward_mode: value === "solana" ? chainConfig[value].rewardMode : undefined,
          wallet_id: selectedWallets[value]?.id,
        })),
        name: name.trim(),
        symbol: symbol.trim(),
        telegram_url: telegram.trim() || undefined,
        twitter_url: twitter.trim() || undefined,
        website_url: website.trim() || undefined,
      };
      const result = await supabase.functions.invoke("web-launch-token", {
        body:
          selectedChains.length === 1
            ? {
                ...body,
                ...body.launches[0],
                launches: undefined,
              }
            : body,
      });
      if (result.error) throw new Error(await readFunctionError(result.error));
      const data = result.data as LaunchBatchResponse | null;
      if (!data || data.error) throw new Error(data?.error ?? "Launch queue failed");
      return data;
    },
    onSuccess: (data) => {
      const queuedChains =
        data.results
          ?.map((result) => result.chain)
          .filter((value): value is LaunchChain => Boolean(value)) ?? selectedChains;
      const label =
        queuedChains.length > 1
          ? "Robinhood Chain and Solana"
          : CHAIN_COPY[queuedChains[0] ?? selectedChains[0]].title;
      toast.success(`${symbolLabel(symbol)} queued for ${label}`);
      qc.invalidateQueries({ queryKey: ["public-live-launches"] });
      qc.invalidateQueries({ queryKey: ["home-dashboard-data"] });
      const address = data.token_address ?? data.mint;
      if (queuedChains.length > 1) {
        void navigate({ to: "/explore" });
      } else if (address) {
        void navigate({ to: "/coin/$mint", params: { mint: address } });
      }
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Launch failed";
      if (message === "login_required") {
        void navigate({ to: "/auth", search: { returnTo: "/launch" } });
        return;
      }
      toast.error(formatLaunchError(message));
    },
  });

  function updateChainConfig(chain: LaunchChain, patch: Partial<ChainLaunchConfig>) {
    setChainConfig((current) => ({
      ...current,
      [chain]: {
        ...current[chain],
        ...patch,
      },
    }));
  }

  async function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/^image\/(png|jpeg|jpg|webp|gif)$/i.test(file.type)) {
      toast.error("Use a PNG, JPG, WEBP, or GIF image.");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      toast.error("Image must be 4 MB or smaller.");
      return;
    }
    setImageName(file.name);
    setImageDataUrl(await readFileDataUrl(file));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!user) {
      void navigate({ to: "/auth", search: { returnTo: "/launch" } });
      return;
    }
    launchMutation.mutate();
  }

  const canSubmit =
    Boolean(name.trim()) &&
    Boolean(symbol.trim()) &&
    Boolean(description.trim()) &&
    Boolean(imageDataUrl) &&
    selectedChains.every((value) => Boolean(selectedWallets[value])) &&
    selectedChains.every((value) => isRewardConfigComplete(value, chainConfig[value])) &&
    name.trim().length <= strictLimits.name_max &&
    symbolLabel(symbol).length <= strictLimits.symbol_max;

  return (
    <div className="sm-launcher-page">
      <MarketingHeader />
      <main className="sm-launcher-shell">
        <form className="sm-launcher-grid" onSubmit={submit}>
          <section className="sm-launcher-main-panel">
            <div className="sm-launcher-mode-panel">
              <div className="sm-launcher-mode-copy">
                <span>Launch on</span>
                <strong>
                  {launchMode === "dual" ? "Both chains" : CHAIN_COPY[selectedChains[0]].title}
                </strong>
              </div>
              <div className="sm-launcher-mode-track" role="radiogroup" aria-label="Launch chain">
                {LAUNCH_MODES.map((mode) => (
                  <button
                    aria-checked={launchMode === mode.value}
                    data-mode={mode.value}
                    key={mode.value}
                    onClick={() => setLaunchMode(mode.value)}
                    role="radio"
                    type="button"
                  >
                    <span className="sm-launcher-choice-mark" aria-hidden="true" />
                    <span className="sm-launcher-chain-visual" aria-hidden="true">
                      {mode.value === "dual" ? (
                        <span className="sm-launcher-chain-logo-pair">
                          <span className="sm-launcher-chain-logo-tile">
                            <img
                              className="sm-launcher-chain-logo-image"
                              src={LAUNCH_CHAIN_ICON_SRC.robinhood}
                              alt=""
                            />
                          </span>
                          <span className="sm-launcher-chain-logo-tile">
                            <img
                              className="sm-launcher-chain-logo-image"
                              src={LAUNCH_CHAIN_ICON_SRC.solana}
                              alt=""
                            />
                          </span>
                        </span>
                      ) : (
                        <span className="sm-launcher-chain-logo-tile">
                          <img
                            className="sm-launcher-chain-logo-image"
                            src={LAUNCH_CHAIN_ICON_SRC[mode.value]}
                            alt=""
                          />
                        </span>
                      )}
                    </span>
                    <span className="sm-launcher-choice-copy">
                      <strong>{mode.title}</strong>
                      <small>{mode.subtitle}</small>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <section className="sm-launcher-form-section">
              <div className="sm-launcher-section-head">
                <div>
                  <span>01</span>
                  <h2>Token details</h2>
                </div>
              </div>

              <div className="sm-launcher-field-grid">
                <div className="sm-launcher-field">
                  <Label htmlFor="coin-name">Name</Label>
                  <Input
                    id="coin-name"
                    maxLength={strictLimits.name_max}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={selectedChains.length > 1 ? "Moon Sync" : "Moon Market"}
                    value={name}
                  />
                </div>
                <div className="sm-launcher-field">
                  <Label htmlFor="coin-symbol">Ticker</Label>
                  <Input
                    className="sm-mono"
                    id="coin-symbol"
                    maxLength={strictLimits.symbol_max}
                    onChange={(event) => setSymbol(symbolLabel(event.target.value))}
                    placeholder="MOON"
                    value={symbol}
                  />
                </div>
              </div>

              <div className="sm-launcher-field">
                <Label htmlFor="coin-description">Description</Label>
                <Textarea
                  id="coin-description"
                  maxLength={512}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="A concise public description for token metadata."
                  rows={5}
                  value={description}
                />
              </div>
            </section>

            <section className="sm-launcher-form-section">
              <div className="sm-launcher-section-head">
                <div>
                  <span>02</span>
                  <h2>Media &amp; branding</h2>
                </div>
              </div>
              <div className="sm-launcher-image-row">
                <label className="sm-launcher-image-picker" htmlFor="coin-image">
                  {imageDataUrl ? (
                    <img src={imageDataUrl} alt="" />
                  ) : (
                    <span>
                      <ImagePlus aria-hidden="true" />
                    </span>
                  )}
                  <input
                    accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
                    id="coin-image"
                    onChange={handleImageChange}
                    type="file"
                  />
                </label>
                <div>
                  <Label htmlFor="coin-image">Token image</Label>
                  <p>{imageName || "PNG, JPG, WEBP, or GIF. Max 4 MB."}</p>
                </div>
              </div>
            </section>

            <section className="sm-launcher-form-section">
              <div className="sm-launcher-section-head">
                <div>
                  <span>03</span>
                  <h2>Social links</h2>
                </div>
              </div>
              <div className="sm-launcher-field-grid sm-launcher-field-grid-thirds">
                <div className="sm-launcher-field">
                  <Label htmlFor="website">Website</Label>
                  <Input
                    id="website"
                    onChange={(event) => setWebsite(event.target.value)}
                    placeholder="https://example.com"
                    value={website}
                  />
                </div>
                <div className="sm-launcher-field">
                  <Label htmlFor="twitter">X / Twitter</Label>
                  <Input
                    id="twitter"
                    onChange={(event) => setTwitter(event.target.value)}
                    placeholder="https://x.com/project"
                    value={twitter}
                  />
                </div>
                <div className="sm-launcher-field">
                  <Label htmlFor="telegram">Telegram</Label>
                  <Input
                    id="telegram"
                    onChange={(event) => setTelegram(event.target.value)}
                    placeholder="projectchat"
                    value={telegram}
                  />
                </div>
              </div>
            </section>
          </section>

          <aside className="sm-launcher-side-panel">
            {selectedChains.map((value) => {
              const wallets = walletsByChain[value];
              const selectedWallet = selectedWallets[value];
              const config = chainConfig[value];
              const chainLimit = limits[value] ?? DEFAULT_LIMITS[value];
              const recipientSharePercent = Math.round(config.rewardShareBps / 100);
              const creatorSharePercent = Math.max(0, 100 - recipientSharePercent);
              return (
                <section
                  className="sm-launcher-side-section sm-launcher-lane-config"
                  data-chain={value}
                  key={value}
                >
                  <div className="sm-launcher-side-title">
                    <Wallet aria-hidden="true" />
                    <div>
                      <h2>{CHAIN_COPY[value].title}</h2>
                    </div>
                  </div>

                  {!user && !loading && (
                    <div className="sm-launcher-login-callout">
                      <AlertCircle aria-hidden="true" />
                      <span>Log in to select wallets and queue launches.</span>
                    </div>
                  )}

                  {user && contextQuery.isLoading && (
                    <div className="sm-launcher-wallet-empty">Loading wallets...</div>
                  )}

                  {user && !contextQuery.isLoading && wallets.length === 0 && (
                    <div className="sm-launcher-wallet-empty">
                      No {CHAIN_COPY[value].title} wallet yet. Create one from the wallet page.
                      <Link to="/app/wallet">Open wallet</Link>
                    </div>
                  )}

                  <div className="sm-launcher-wallet-list">
                    {wallets.map((wallet) => (
                      <button
                        aria-pressed={selectedWallet?.id === wallet.id}
                        key={wallet.id}
                        onClick={() => updateChainConfig(value, { walletId: wallet.id })}
                        type="button"
                      >
                        <span>
                          <strong>{shortAddress(wallet.address, 6, 5)}</strong>
                          {wallet.is_primary && <b>Primary</b>}
                        </span>
                        <small>
                          {formatWalletBalance(wallet)} {wallet.native_symbol}
                        </small>
                      </button>
                    ))}
                  </div>

                  <div className="sm-launcher-lane-controls">
                    <div className="sm-launcher-field">
                      <Label htmlFor={`dev-buy-${value}`}>
                        Dev buy ({chainLimit.native_symbol})
                      </Label>
                      <Input
                        id={`dev-buy-${value}`}
                        inputMode="decimal"
                        onChange={(event) =>
                          updateChainConfig(value, { devBuy: event.target.value })
                        }
                        placeholder={CHAIN_COPY[value].devBuyPlaceholder}
                        value={config.devBuy}
                      />
                    </div>
                    {value === "robinhood" ? (
                      <div className="sm-launcher-field">
                        <Label htmlFor="robinhood-reward-recipient">Creator reward receiver</Label>
                        <Input
                          className="sm-mono sm-launcher-reward-recipient-input"
                          id="robinhood-reward-recipient"
                          onChange={(event) =>
                            updateChainConfig(value, { rewardRecipient: event.target.value })
                          }
                          placeholder="Optional 0x wallet"
                          value={config.rewardRecipient}
                        />
                      </div>
                    ) : (
                      <div className="sm-launcher-reward-card">
                        <div className="sm-launcher-reward-card-head">
                          <span>Rewards</span>
                          <strong>
                            {config.rewardMode === "cashback" ? "Trader cashback" : "Creator fees"}
                          </strong>
                        </div>
                        <div
                          className="sm-launcher-reward-mode"
                          role="radiogroup"
                          aria-label="Solana reward mode"
                        >
                          {(
                            [
                              ["creator", "Creator fees"],
                              ["cashback", "Cashback"],
                            ] as const
                          ).map(([mode, label]) => (
                            <button
                              aria-checked={config.rewardMode === mode}
                              key={mode}
                              onClick={() =>
                                updateChainConfig(value, {
                                  rewardMode: mode,
                                  rewardShareEnabled:
                                    mode === "creator" ? config.rewardShareEnabled : false,
                                })
                              }
                              role="radio"
                              type="button"
                            >
                              <span className="sm-launcher-choice-check" aria-hidden="true">
                                <Check />
                              </span>
                              <span className="sm-launcher-reward-label">{label}</span>
                            </button>
                          ))}
                        </div>
                        <p className="sm-launcher-field-note">
                          {config.rewardMode === "cashback"
                            ? "Cashback launches route Pump creator fees to eligible traders."
                            : "Keep Pump creator fees with your launch wallet or split a share with a Solana wallet or X handle."}
                        </p>
                        <div className="sm-launcher-share-box">
                          {config.rewardMode === "creator" && (
                            <>
                              <button
                                aria-pressed={config.rewardShareEnabled}
                                className="sm-launcher-share-toggle"
                                onClick={() =>
                                  updateChainConfig(value, {
                                    rewardShareEnabled: !config.rewardShareEnabled,
                                  })
                                }
                                type="button"
                              >
                                <span className="sm-launcher-choice-check" aria-hidden="true">
                                  <Check />
                                </span>
                                <span className="sm-launcher-reward-label">
                                  Share creator rewards
                                </span>
                              </button>

                              {config.rewardShareEnabled && (
                                <>
                                  <div className="sm-launcher-field">
                                    <Label htmlFor="solana-reward-recipient">
                                      Reward recipient
                                    </Label>
                                    <Input
                                      className="sm-mono sm-launcher-reward-recipient-input"
                                      id="solana-reward-recipient"
                                      onChange={(event) =>
                                        updateChainConfig(value, {
                                          rewardRecipient: event.target.value,
                                        })
                                      }
                                      placeholder="Solana wallet or @handle"
                                      value={config.rewardRecipient}
                                    />
                                  </div>
                                  <div
                                    className="sm-launcher-split-control"
                                    style={
                                      {
                                        "--reward-share": `${recipientSharePercent}%`,
                                      } as CSSProperties
                                    }
                                  >
                                    <div className="sm-launcher-split-stat" data-owner="creator">
                                      <span>Creator</span>
                                      <strong>{creatorSharePercent}%</strong>
                                    </div>
                                    <div className="sm-launcher-split-stat" data-owner="recipient">
                                      <span>Recipient</span>
                                      <strong>{recipientSharePercent}%</strong>
                                    </div>
                                    <input
                                      aria-label="Recipient creator reward share"
                                      aria-valuetext={`${recipientSharePercent}% to recipient, ${creatorSharePercent}% to creator`}
                                      max={100}
                                      min={1}
                                      onChange={(event) =>
                                        updateChainConfig(value, {
                                          rewardShareBps: Number(event.target.value || 0) * 100,
                                        })
                                      }
                                      step={1}
                                      type="range"
                                      value={recipientSharePercent}
                                    />
                                  </div>
                                </>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              );
            })}

            <section className="sm-launcher-review">
              <div className="sm-launcher-review-heading">
                <span>Review</span>
                <strong>{symbol ? `$${symbol}` : "$TOKEN"}</strong>
              </div>
              <div className="sm-launcher-review-summary">
                <span>{selectedChains.length > 1 ? "Chains" : "Chain"}</span>
                <strong>{reviewChainLabel}</strong>
              </div>
              <div className="sm-launcher-review-summary">
                <span>{activeWallets.length > 1 ? "Wallets" : "Wallet"}</span>
                <strong>{reviewWalletLabel}</strong>
              </div>
              <div className="sm-launcher-review-summary">
                <span>Rewards</span>
                <strong>{reviewRewardLabel}</strong>
              </div>
              <Button
                className="sm-launcher-submit"
                disabled={launchMutation.isPending || (!!user && !canSubmit)}
                type="submit"
              >
                {launchMutation.isPending ? (
                  <Loader2 aria-hidden="true" className="animate-spin" />
                ) : (
                  <Rocket aria-hidden="true" />
                )}
                {user
                  ? selectedChains.length > 1
                    ? "Queue dual launch"
                    : "Queue launch"
                  : "Log in to launch"}
              </Button>
              {activeWallets.length === 1 && activeWallets[0]?.explorer_url && (
                <a href={activeWallets[0].explorer_url} target="_blank" rel="noreferrer">
                  View selected wallet <ExternalLink aria-hidden="true" />
                </a>
              )}
            </section>
          </aside>
        </form>
      </main>
    </div>
  );
}

async function readFunctionError(error: unknown) {
  const maybe = error as { context?: { json?: () => Promise<unknown> }; message?: string };
  const body = await maybe.context?.json?.().catch(() => null);
  if (body && typeof body === "object" && "error" in body) {
    return String((body as { error: unknown }).error);
  }
  return maybe.message ?? "Launch failed";
}

function readFileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Image read failed"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
}

function symbolLabel(value: string) {
  return value
    .replace(/^\$/, "")
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase();
}

function cleanOptional(value: string) {
  const text = value.trim();
  return text || undefined;
}

function isRewardConfigComplete(chain: LaunchChain, config: ChainLaunchConfig) {
  if (chain === "robinhood") {
    const recipient = config.rewardRecipient.trim();
    return !recipient || EVM_ADDRESS_RE.test(recipient);
  }
  if (config.rewardMode === "cashback") return true;
  if (!config.rewardShareEnabled) return true;
  const recipient = config.rewardRecipient.trim();
  return (
    (SOLANA_ADDRESS_RE.test(recipient) || X_HANDLE_RE.test(recipient)) &&
    config.rewardShareBps > 0 &&
    config.rewardShareBps <= 10_000
  );
}

function rewardReviewLabel(chain: LaunchChain, config: ChainLaunchConfig) {
  if (chain === "robinhood") {
    return config.rewardRecipient.trim()
      ? `Robinhood rewards to ${shortAddress(config.rewardRecipient.trim(), 4, 4)}`
      : "Robinhood creator rewards";
  }
  if (config.rewardMode === "cashback") return "Pump cashback";
  if (!config.rewardShareEnabled || !config.rewardRecipient.trim()) return "Pump creator fees";
  const recipientPercent = Math.round(config.rewardShareBps / 100);
  return `Pump ${100 - recipientPercent}/${recipientPercent} split with ${rewardRecipientLabel(config.rewardRecipient)}`;
}

function rewardRecipientLabel(value: string) {
  const text = value.trim();
  if (!text) return "recipient";
  if (text.startsWith("@") || X_HANDLE_RE.test(text))
    return text.startsWith("@") ? text : `@${text}`;
  return shortAddress(text, 4, 4);
}

function formatWalletBalance(wallet: LaunchWallet) {
  const native = Number(wallet.balance?.native ?? NaN);
  if (!Number.isFinite(native)) return "--";
  return wallet.native_symbol === "SOL" ? native.toFixed(4) : formatEth(native, 4);
}

function formatLaunchError(message: string) {
  if (message.startsWith("insufficient_eth:") || message.startsWith("insufficient_sol:")) {
    return message.split(":").slice(1).join(":");
  }
  if (message.includes("invalid_name")) return "Check the token name length.";
  if (message.includes("invalid_symbol")) return "Check the ticker length and characters.";
  if (message.includes("missing_image")) return "Add a token image before launching.";
  if (
    message.includes("invalid_solana_reward_recipient") ||
    message.includes("invalid_creator_rewards_wallet")
  ) {
    return "Check the Solana reward recipient.";
  }
  if (message.includes("invalid_creator_reward_share_bps"))
    return "Check the creator reward split.";
  if (message.includes("creator_reward_recipient_matches_creator")) {
    return "Choose a different wallet for the reward recipient.";
  }
  if (message.includes("creator_rewards_recipient_x_user_not_found")) {
    return "That X handle could not be found for creator reward sharing.";
  }
  if (message.includes("invalid_address")) return "Check the Robinhood reward receiver address.";
  return message;
}
