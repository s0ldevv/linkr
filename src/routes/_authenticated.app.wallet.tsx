import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RobinhoodLogo, SolanaLogo } from "@/components/linkr/ChainLogos";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ArrowDownUp,
  ArrowRight,
  ChevronDown,
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Plus,
  QrCode,
  Send,
  ShieldAlert,
  ShieldCheck,
  Star,
  TimerReset,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { shortAddress } from "@/lib/linkr/format";
import { subscribeToAuthPopupResults, type AuthPopupResult } from "@/lib/linkr/auth-popup";
import { useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/_authenticated/app/wallet")({
  head: () => ({ meta: [{ title: "Wallet - Linkr" }] }),
  component: WalletPage,
});

const EXPORT_CONFIRMATION = "EXPORT";
const EXPORT_DISPLAY_SECONDS = 90;
const EXPORT_AUTH_TIMEOUT_MS = 3 * 60 * 1000;
const EXPORT_AUTH_CLOSE_GRACE_MS = 4_000;

type ExportAuthStage = "ready" | "waiting" | "syncing" | "exporting" | "error";

type PrivateKeyExport = {
  wallet_id: string;
  address: string;
  public_key: string;
  chain_id: number | null;
  wallet_type: string;
  private_key_hex?: string;
  private_key_base58?: string;
  private_key_format: string;
  explorer_url: string;
  exported_at: string;
};

type ExportPrivateKeyResponse = PrivateKeyExport | { error: string };

type ExportChallengeResponse = {
  challenge_token?: string;
  expires_at?: string;
  error?: string;
};

type WalletRecord = {
  id: string;
  public_key: string;
  address?: string | null;
  chain_id?: number | null;
  wallet_type?: string | null;
  explorer_url?: string | null;
  is_primary: boolean;
  created_at: string;
};

type WalletChain = "evm" | "solana";

type WalletBalance = {
  wallet_id: string;
  address: string;
  wallet_type: WalletChain;
  is_primary: boolean;
  native_symbol: "ETH" | "SOL";
  native_balance: number | null;
  native_price_usd: number | null;
  usdc_balance: string | null;
  explorer_url?: string | null;
  error?: string | null;
};

type WalletBalancesResponse = { balances: WalletBalance[]; fetched_at: string };

function formatBalance(value: number | string | null | undefined, maximumFractionDigits = 6) {
  if (value === null || value === undefined || value === "") return "--";
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return "--";
  return numeric.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits,
  });
}

function formatUsdEquivalent(balance: number | null | undefined, price: number | null | undefined) {
  if (!Number.isFinite(balance) || !Number.isFinite(price)) return null;
  return formatUsdValue(Number(balance) * Number(price));
}

function formatUsdValue(value: number | null | undefined) {
  if (!Number.isFinite(value)) return null;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

type CreateWalletResponse = {
  id?: string | null;
  public_key?: string;
  address?: string | null;
  chain_id?: number | null;
  wallet_type?: string | null;
  explorer_url?: string | null;
  is_primary?: boolean;
  created_at?: string | null;
  error?: string;
} | null;

type WalletTransaction = {
  id: string;
  action: string | null;
  amount_eth?: number | null;
  amount_sol?: number | null;
  amount_original?: number | null;
  native_symbol?: string | null;
  tx_hash?: string | null;
  tx_signature?: string | null;
  explorer_url?: string | null;
  created_at: string | null;
};

function formatTransferError(message: string) {
  if (message === "transfer_disabled") {
    return "Transfers are disabled by your rules. Set a transfer cap in Rules first.";
  }
  if (message === "max_auto_transfer_sol_exceeded") {
    return "This SOL transfer is above your Solana transfer cap.";
  }
  if (message === "max_auto_transfer_eth_exceeded") {
    return "This ETH transfer is above your EVM transfer cap.";
  }
  if (message === "usdc_transfer_disabled") {
    return "USDC transfers are disabled by your rules. Set a USDC transfer cap in Rules first.";
  }
  if (message === "max_auto_transfer_usdc_exceeded") {
    return "This USDC transfer is above your Solana USDC transfer cap.";
  }
  if (message === "insufficient_sol_for_usdc_transfer_fee") {
    return "Your Solana wallet needs a little SOL for the network fee and, when needed, the recipient's USDC account rent.";
  }
  if (message === "insufficient_sol_for_swap_fee") {
    return "Your Solana wallet needs a little more SOL for swap fees and token-account setup.";
  }
  if (message === "transfer_already_in_progress") {
    return "That transfer is already being processed. It was not submitted a second time.";
  }
  if (message === "transfer_status_uncertain") {
    return "The network result is uncertain, so Linkr locked this request against retries. Check transaction history before trying a new transfer.";
  }
  return message;
}

async function readFunctionErrorMessage(error: unknown, fallback: string) {
  const maybeError = error as {
    context?: { json?: () => Promise<unknown> };
    message?: string;
  };
  const body = await maybeError.context?.json?.().catch(() => null);
  if (body && typeof body === "object" && "error" in body) {
    return String((body as { error: unknown }).error);
  }
  return maybeError.message ?? fallback;
}

function WalletPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [sendAsset, setSendAsset] = useState<"eth" | "sol" | "usdc">("eth");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [swapDirection, setSwapDirection] = useState<"sol_to_usdc" | "usdc_to_sol">("sol_to_usdc");
  const [swapAmount, setSwapAmount] = useState("");
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [importChain, setImportChain] = useState<WalletChain | null>(null);
  const [importPrivateKey, setImportPrivateKey] = useState("");
  const [showImportPrivateKey, setShowImportPrivateKey] = useState(false);
  const [importPending, setImportPending] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [selectedExportWallet, setSelectedExportWallet] = useState<WalletRecord | null>(null);
  const [exportPhrase, setExportPhrase] = useState("");
  const [exportAcknowledged, setExportAcknowledged] = useState(false);
  const [keyExport, setKeyExport] = useState<PrivateKeyExport | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [exportAuthStage, setExportAuthStage] = useState<ExportAuthStage>("ready");
  const [exportAuthError, setExportAuthError] = useState<string | null>(null);
  const exportAuthPopupRef = useRef<Window | null>(null);
  const exportAuthPopupCheckRef = useRef<number | undefined>(undefined);
  const exportAuthTimeoutRef = useRef<number | undefined>(undefined);
  const exportAuthCloseGraceRef = useRef<number | undefined>(undefined);
  const exportAuthFlowRef = useRef<string | null>(null);
  const exportAuthPreviousTokenRef = useRef<string | null>(null);
  const exportDialogOpenRef = useRef(false);
  const exportAttemptRef = useRef(0);
  const startPrivateKeyExportRef = useRef<() => void>(() => undefined);

  const walletsQuery = useQuery({
    queryKey: ["wallets", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_my_wallets");
      if (error) throw error;
      return (data ?? []) as WalletRecord[];
    },
  });

  const wallets = walletsQuery.data ?? [];
  const evmWallets = wallets.filter((wallet) => wallet.wallet_type === "evm");
  const solanaWallets = wallets.filter((wallet) => wallet.wallet_type === "solana");
  const primaryEvmWallet = evmWallets.find((wallet) => wallet.is_primary) ?? evmWallets[0] ?? null;
  const primarySolanaWallet =
    solanaWallets.find((wallet) => wallet.is_primary) ?? solanaWallets[0] ?? null;
  const pk = primaryEvmWallet?.address ?? primaryEvmWallet?.public_key ?? null;
  const solanaPk = primarySolanaWallet?.address ?? primarySolanaWallet?.public_key ?? null;

  const walletBalancesQuery = useQuery({
    queryKey: ["wallet-balances", user?.id],
    enabled: !!user,
    refetchInterval: 30_000,
    retry: (failureCount, error) => !(error instanceof SessionExpiredError) && failureCount < 2,
    queryFn: async () => {
      const r = await invokeAuthenticatedFunction<WalletBalancesResponse>("wallet-balances", {});
      if (r.error) throw new Error(r.error.message);
      const data = r.data as WalletBalancesResponse | null;
      if (!data || !Array.isArray(data.balances)) throw new Error("Wallet balance lookup failed");
      return data;
    },
  });

  const txQuery = useQuery({
    queryKey: ["wallet-tx", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as WalletTransaction[];
    },
  });

  const sendMut = useMutation({
    mutationFn: async () => {
      const isSol = sendAsset === "sol";
      const isUsdc = sendAsset === "usdc";
      const functionName = isUsdc ? "transfer-usdc" : isSol ? "transfer-sol" : "transfer-eth";
      const body = isUsdc
        ? {
            recipient: recipient.trim(),
            amount_usdc: amount.trim(),
            idempotency_key: crypto.randomUUID(),
          }
        : isSol
          ? { recipient: recipient.trim(), amount_sol: amount.trim() }
          : { recipient: recipient.trim(), amount_eth: Number(amount) };
      const r = await supabase.functions.invoke(functionName, { body });
      if (r.error) throw new Error(await readFunctionErrorMessage(r.error, "Transfer failed"));
      const data = r.data as {
        tx_hash?: string;
        signature?: string;
        explorer_url?: string;
        error?: string;
      };
      if (data.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (d) => {
      const txHash = d.tx_hash ?? d.signature;
      const unit = sendAsset.toUpperCase();
      toast.success(`Sent ${unit}. TX: ${txHash?.slice(0, 10)}...`);
      setRecipient("");
      setAmount("");
      qc.invalidateQueries({ queryKey: ["wallet-tx"] });
      qc.invalidateQueries({ queryKey: ["wallet-balance", pk] });
      qc.invalidateQueries({ queryKey: ["solana-wallet-balance"] });
      qc.invalidateQueries({ queryKey: ["wallet-balances"] });
    },
    onError: (error: unknown) =>
      toast.error(formatTransferError(error instanceof Error ? error.message : "Transfer failed")),
  });

  const swapMut = useMutation({
    mutationFn: async () => {
      const r = await supabase.functions.invoke("swap-sol-usdc", {
        body: {
          direction: swapDirection,
          amount: swapAmount.trim(),
          idempotency_key: crypto.randomUUID(),
        },
      });
      if (r.error) throw new Error(await readFunctionErrorMessage(r.error, "Swap failed"));
      const data = r.data as { tx_hash?: string; signature?: string; error?: string };
      if (data.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      const output = swapDirection === "sol_to_usdc" ? "USDC" : "SOL";
      const txHash = data.tx_hash ?? data.signature;
      toast.success(`Swap to ${output} confirmed. TX: ${txHash?.slice(0, 10)}...`);
      setSwapAmount("");
      qc.invalidateQueries({ queryKey: ["wallet-tx"] });
      qc.invalidateQueries({ queryKey: ["solana-wallet-balance"] });
      qc.invalidateQueries({ queryKey: ["wallet-balances"] });
    },
    onError: (error: unknown) =>
      toast.error(formatTransferError(error instanceof Error ? error.message : "Swap failed")),
  });

  const createWalletMut = useMutation({
    mutationFn: async (chain: WalletChain) => {
      const r = await supabase.functions.invoke("create-user-wallet", {
        body: { chain },
      });
      if (r.error) throw new Error(r.error.message);
      const data = r.data as CreateWalletResponse;
      if (data?.error) throw new Error(data.error);
      if (!data?.public_key) throw new Error("Wallet creation failed");
      return data;
    },
    onSuccess: (wallet) => {
      const chainLabel = wallet.wallet_type === "solana" ? "Solana" : "EVM";
      toast.success(`${chainLabel} wallet ${shortAddress(wallet.public_key, 5, 5)} generated`);
      qc.invalidateQueries({ queryKey: ["wallets", user?.id] });
      qc.invalidateQueries({ queryKey: ["wallet-pk", user?.id] });
      qc.invalidateQueries({ queryKey: ["solana-wallet-balance"] });
      qc.invalidateQueries({ queryKey: ["wallet-balances"] });
      qc.invalidateQueries({ queryKey: ["home-dashboard-data"] });
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Wallet creation failed"),
  });

  const closeImportDialog = (open: boolean) => {
    if (open) return;
    setImportChain(null);
    setImportPrivateKey("");
    setShowImportPrivateKey(false);
    setImportError(null);
  };

  const submitWalletImport = async () => {
    if (!importChain || !importPrivateKey.trim() || importPending) return;
    setImportPending(true);
    setImportError(null);
    try {
      const result = await supabase.functions.invoke("import-user-wallet", {
        body: { chain: importChain, private_key: importPrivateKey.trim() },
      });
      if (result.error) {
        throw new Error(await readFunctionErrorMessage(result.error, "Wallet import failed"));
      }
      const wallet = result.data as CreateWalletResponse;
      if (wallet?.error) throw new Error(wallet.error);
      if (!wallet?.public_key) throw new Error("Wallet import failed");
      const chainLabel = importChain === "solana" ? "Solana" : "EVM";
      setImportPrivateKey("");
      closeImportDialog(false);
      toast.success(`${chainLabel} wallet ${shortAddress(wallet.public_key, 5, 5)} imported`);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["wallets", user?.id] }),
        qc.invalidateQueries({ queryKey: ["wallet-pk", user?.id] }),
        qc.invalidateQueries({ queryKey: ["solana-wallet-balance"] }),
        qc.invalidateQueries({ queryKey: ["wallet-balances"] }),
        qc.invalidateQueries({ queryKey: ["home-dashboard-data"] }),
      ]);
    } catch (error) {
      const code = error instanceof Error ? error.message : "Wallet import failed";
      const message =
        code === "wallet_already_imported"
          ? "This wallet is already in your account."
          : code === "invalid_solana_private_key"
            ? "Enter a valid Solana base58 private key or 64-byte JSON key array."
            : code === "invalid_evm_private_key"
              ? "Enter a valid 32-byte EVM private key."
              : code === "rate_limit_exceeded"
                ? "Too many import attempts. Please try again later."
                : code;
      setImportError(message);
    } finally {
      setImportPending(false);
    }
  };

  const primaryMut = useMutation({
    mutationFn: async (walletId: string) => {
      const { data, error } = await supabase.rpc("set_my_primary_wallet", {
        p_wallet_id: walletId,
      });
      if (error) throw error;
      const wallet = Array.isArray(data) ? (data[0] as WalletRecord | undefined) : undefined;
      if (!wallet?.public_key) throw new Error("Primary wallet update failed");
      return wallet;
    },
    onSuccess: (wallet) => {
      toast.success(`Primary wallet set to ${shortAddress(wallet.public_key, 5, 5)}`);
      qc.invalidateQueries({ queryKey: ["wallets", user?.id] });
      qc.invalidateQueries({ queryKey: ["wallet-pk", user?.id] });
      qc.invalidateQueries({ queryKey: ["wallet-balance"] });
      qc.invalidateQueries({ queryKey: ["solana-wallet-balance"] });
      qc.invalidateQueries({ queryKey: ["wallet-balances"] });
      qc.invalidateQueries({ queryKey: ["home-dashboard-data"] });
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Primary wallet update failed"),
  });

  const canExportPrivateKey =
    exportPhrase.trim().toUpperCase() === EXPORT_CONFIRMATION && exportAcknowledged;

  const exportMut = useMutation({
    mutationFn: async () => {
      if (!selectedExportWallet?.id) throw new Error("Choose a wallet to export");
      const attemptId = ++exportAttemptRef.current;

      const challenge = await supabase.functions.invoke("export-wallet-private-key", {
        body: {
          action: "challenge",
          wallet_id: selectedExportWallet.id,
        },
      });
      if (challenge.error) {
        throw new Error(
          await readFunctionErrorMessage(challenge.error, "Could not prepare secure export"),
        );
      }
      const challengeData = challenge.data as ExportChallengeResponse | null;
      if (challengeData?.error) throw new Error(challengeData.error);
      if (!challengeData?.challenge_token) throw new Error("Could not prepare secure export");

      const r = await supabase.functions.invoke("export-wallet-private-key", {
        body: {
          action: "export",
          confirmation: exportPhrase.trim().toUpperCase(),
          wallet_id: selectedExportWallet.id,
          challenge_token: challengeData.challenge_token,
        },
      });
      if (r.error) {
        throw new Error(await readFunctionErrorMessage(r.error, "Private key export failed"));
      }

      const data = r.data as ExportPrivateKeyResponse | null;
      if (!data) throw new Error("Private key export failed");
      if ("error" in data) throw new Error(data.error);

      return { data, attemptId };
    },
    onSuccess: (result) => {
      if (!exportDialogOpenRef.current || result.attemptId !== exportAttemptRef.current) return;
      const data = result.data;
      setKeyExport(data);
      setShowSecret(true);
      setSecondsRemaining(EXPORT_DISPLAY_SECONDS);
      setExportPhrase("");
      setExportAcknowledged(false);
      setExportAuthStage("ready");
      setExportAuthError(null);
      toast.success("Private key ready inside the export modal.");
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Private key export failed";
      if (message === "reauthentication_required") {
        setExportAuthStage("error");
        setExportAuthError("Your verification expired. Verify with X once more to continue.");
        toast.warning("Your X verification expired. Please try again.");
        return;
      }
      setExportAuthStage("error");
      setExportAuthError(message);
      toast.error(message);
    },
  });

  startPrivateKeyExportRef.current = () => {
    setExportAuthStage("exporting");
    setExportAuthError(null);
    exportMut.mutate();
  };

  useEffect(() => {
    let handlingResult = false;
    const onAuthResult = async (data: AuthPopupResult) => {
      if (
        data?.type !== "linkr:auth" ||
        !exportAuthFlowRef.current ||
        data.flowId !== exportAuthFlowRef.current ||
        handlingResult
      ) {
        return;
      }
      handlingResult = true;

      window.clearInterval(exportAuthPopupCheckRef.current);
      window.clearTimeout(exportAuthTimeoutRef.current);
      window.clearTimeout(exportAuthCloseGraceRef.current);
      exportAuthPopupCheckRef.current = undefined;
      exportAuthTimeoutRef.current = undefined;
      exportAuthCloseGraceRef.current = undefined;
      exportAuthPopupRef.current?.close();
      exportAuthPopupRef.current = null;
      exportAuthFlowRef.current = null;

      if (data.status === "ok") {
        setExportAuthStage("syncing");
        setExportAuthError(null);
        const authenticatedUserId =
          data.handoffCode && data.handoffRedirectTo
            ? await installWalletExportSession(data.handoffCode, data.handoffRedirectTo)
            : await waitForFreshLinkrSession(user?.id ?? null, exportAuthPreviousTokenRef.current);
        exportAuthPreviousTokenRef.current = null;
        if (
          !authenticatedUserId ||
          authenticatedUserId !== user?.id ||
          (data.userId !== null && data.userId !== undefined && data.userId !== user?.id)
        ) {
          const message =
            data.userId && data.userId !== user?.id
              ? "That X account does not match this Linkr account."
              : "The refreshed Linkr session could not be verified. Please try again.";
          setExportAuthStage("error");
          setExportAuthError(message);
          toast.error(message);
          return;
        }
        toast.success("X identity verified. Unlocking your secure export...");
        qc.invalidateQueries({ queryKey: ["solana-wallet-balance"] });
        qc.invalidateQueries({ queryKey: ["wallet-balances"] });
        startPrivateKeyExportRef.current();
      } else {
        exportAuthPreviousTokenRef.current = null;
        const message = data.message || "X verification did not finish.";
        setExportAuthStage("error");
        setExportAuthError(message);
        toast.error(message);
      }
    };

    const unsubscribe = subscribeToAuthPopupResults(onAuthResult);
    return () => {
      unsubscribe();
      window.clearInterval(exportAuthPopupCheckRef.current);
      window.clearTimeout(exportAuthTimeoutRef.current);
      window.clearTimeout(exportAuthCloseGraceRef.current);
      exportAuthPopupRef.current?.close();
    };
  }, [qc, user?.id]);

  useEffect(() => {
    if (!keyExport || secondsRemaining <= 0) return;
    const timer = window.setInterval(() => {
      setSecondsRemaining((current) => Math.max(0, current - 1));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [keyExport, secondsRemaining]);

  useEffect(() => {
    if (!keyExport || secondsRemaining > 0) return;
    setKeyExport(null);
    setShowSecret(false);
    toast.info("Private key cleared from this screen");
  }, [keyExport, secondsRemaining]);

  function resetExportDialog(open: boolean) {
    exportDialogOpenRef.current = open;
    setExportDialogOpen(open);
    if (!open) {
      exportAttemptRef.current += 1;
      setExportPhrase("");
      setExportAcknowledged(false);
      setSelectedExportWallet(null);
      setKeyExport(null);
      setShowSecret(false);
      setSecondsRemaining(0);
      closeExportAuthPopup();
      setExportAuthStage("ready");
      setExportAuthError(null);
    }
  }

  function openExportDialog(wallet: WalletRecord) {
    exportDialogOpenRef.current = true;
    setSelectedExportWallet(wallet);
    setKeyExport(null);
    setShowSecret(false);
    setSecondsRemaining(0);
    setExportPhrase("");
    setExportAcknowledged(false);
    closeExportAuthPopup();
    setExportAuthStage("ready");
    setExportAuthError(null);
    setExportDialogOpen(true);
  }

  function closeExportAuthPopup() {
    window.clearInterval(exportAuthPopupCheckRef.current);
    window.clearTimeout(exportAuthTimeoutRef.current);
    window.clearTimeout(exportAuthCloseGraceRef.current);
    exportAuthPopupCheckRef.current = undefined;
    exportAuthTimeoutRef.current = undefined;
    exportAuthCloseGraceRef.current = undefined;
    exportAuthFlowRef.current = null;
    exportAuthPreviousTokenRef.current = null;
    exportAuthPopupRef.current?.close();
    exportAuthPopupRef.current = null;
  }

  async function reauthenticateWalletExport() {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    if (!supabaseUrl) {
      toast.error("Supabase URL is not configured.");
      return;
    }
    const currentSession = await supabase.auth.getSession();
    if (currentSession.error || !currentSession.data.session) {
      const message = "Your Linkr session is unavailable. Sign in again before exporting.";
      setExportAuthStage("error");
      setExportAuthError(message);
      toast.error(message);
      return;
    }
    exportAuthPreviousTokenRef.current = currentSession.data.session.access_token;
    const loginUrl = new URL(`${supabaseUrl.replace(/\/+$/, "")}/functions/v1/x-oauth/user`);
    const redirectTo = new URL("/auth/callback", window.location.origin);
    const flowId = createAuthFlowId();
    redirectTo.searchParams.set("auth_popup", "1");
    redirectTo.searchParams.set("auth_flow", flowId);
    redirectTo.searchParams.set("wallet_export", "1");
    loginUrl.searchParams.set("redirect_to", redirectTo.toString());
    if (user?.id) loginUrl.searchParams.set("expected_user_id", user.id);

    const popup = openCenteredAuthPopup(loginUrl.toString());
    if (!popup) {
      exportAuthPreviousTokenRef.current = null;
      const message = "Popups are blocked. Allow popups for Linkr, then try again.";
      setExportAuthStage("error");
      setExportAuthError(message);
      toast.error(message);
      return;
    }
    exportAuthPopupRef.current = popup;
    exportAuthFlowRef.current = flowId;
    setExportAuthStage("waiting");
    setExportAuthError(null);
    popup.focus();
    window.clearInterval(exportAuthPopupCheckRef.current);
    exportAuthPopupCheckRef.current = window.setInterval(() => {
      if (!popup.closed) return;
      window.clearInterval(exportAuthPopupCheckRef.current);
      window.clearTimeout(exportAuthTimeoutRef.current);
      exportAuthPopupCheckRef.current = undefined;
      exportAuthTimeoutRef.current = undefined;
      exportAuthPopupRef.current = null;
      window.clearTimeout(exportAuthCloseGraceRef.current);
      exportAuthCloseGraceRef.current = window.setTimeout(() => {
        exportAuthCloseGraceRef.current = undefined;
        if (exportAuthFlowRef.current !== flowId) return;
        exportAuthFlowRef.current = null;
        exportAuthPreviousTokenRef.current = null;
        setExportAuthStage("error");
        setExportAuthError("The X window was closed before verification finished.");
      }, EXPORT_AUTH_CLOSE_GRACE_MS);
    }, 700);
    exportAuthTimeoutRef.current = window.setTimeout(() => {
      closeExportAuthPopup();
      setExportAuthStage("error");
      setExportAuthError("X verification timed out. Nothing was exported; please try again.");
    }, EXPORT_AUTH_TIMEOUT_MS);
  }

  async function copyText(value: string, label: string, key?: string) {
    try {
      await navigator.clipboard.writeText(value);
      if (key) {
        setCopiedKey(key);
        window.setTimeout(() => {
          setCopiedKey((current) => (current === key ? null : current));
        }, 1400);
      }
      toast.success(`${label} copied`);
    } catch (_) {
      toast.error("Copy failed");
    }
  }

  function downloadPrivateKey() {
    if (!keyExport) return;

    const isSolana = keyExport.wallet_type === "solana";
    const secretLabel = isSolana ? "Secret key base58" : "Private key hex";
    const secretValue = keyExport.private_key_base58 ?? keyExport.private_key_hex ?? "";
    const body = [
      `Linkr ${isSolana ? "Solana" : "Robinhood Chain"} private key export`,
      "",
      `Address: ${keyExport.address}`,
      `Wallet type: ${keyExport.wallet_type}`,
      `Chain ID: ${keyExport.chain_id ?? "n/a"}`,
      `${secretLabel}: ${secretValue}`,
      `Explorer: ${keyExport.explorer_url}`,
      `Exported at: ${keyExport.exported_at}`,
      "",
      "Keep this file offline. Anyone with this key can control the wallet.",
    ].join("\n");

    const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `linkr-wallet-${shortAddress(keyExport.address, 6, 6)}-private-key.txt`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    toast.success("Export file downloaded");
  }

  const privateKeyText = keyExport?.private_key_base58 ?? keyExport?.private_key_hex ?? "";
  const displayedPrivateKey = showSecret ? privateKeyText : maskSecret(privateKeyText);
  const exportedKeyLabel =
    keyExport?.wallet_type === "solana" ? "Solana secret key base58" : "Private key hex";
  const selectedExportAddress =
    selectedExportWallet?.address ?? selectedExportWallet?.public_key ?? keyExport?.address ?? null;
  const selectedExportType = selectedExportWallet?.wallet_type ?? keyExport?.wallet_type ?? "evm";
  const sendUnit = sendAsset.toUpperCase();
  const walletBalanceById = new Map(
    (walletBalancesQuery.data?.balances ?? []).map((balance) => [balance.wallet_id, balance]),
  );
  const evmBalanceRows = evmWallets.map((wallet) => walletBalanceById.get(wallet.id));
  const solanaBalanceRows = solanaWallets.map((wallet) => walletBalanceById.get(wallet.id));
  const hasEthBalanceData =
    evmWallets.length > 0 &&
    evmBalanceRows.every((balance) => Number.isFinite(balance?.native_balance));
  const hasSolBalanceData =
    solanaWallets.length > 0 &&
    solanaBalanceRows.every((balance) => Number.isFinite(balance?.native_balance));
  const hasUsdcBalanceData =
    solanaWallets.length > 0 &&
    solanaBalanceRows.every(
      (balance) =>
        balance?.usdc_balance !== null &&
        balance?.usdc_balance !== undefined &&
        Number.isFinite(Number(balance.usdc_balance)),
    );
  const hasEthUsdData =
    hasEthBalanceData &&
    evmBalanceRows.every((balance) => Number.isFinite(balance?.native_price_usd));
  const hasSolUsdData =
    hasSolBalanceData &&
    solanaBalanceRows.every((balance) => Number.isFinite(balance?.native_price_usd));
  const totalEth = evmBalanceRows.reduce(
    (sum, balance) => sum + (Number(balance?.native_balance) || 0),
    0,
  );
  const totalSol = solanaBalanceRows.reduce(
    (sum, balance) => sum + (Number(balance?.native_balance) || 0),
    0,
  );
  const totalUsdc = solanaBalanceRows.reduce(
    (sum, balance) => sum + (Number(balance?.usdc_balance) || 0),
    0,
  );
  const totalEthUsd = evmBalanceRows.reduce(
    (sum, balance) =>
      sum + (Number(balance?.native_balance) || 0) * (Number(balance?.native_price_usd) || 0),
    0,
  );
  const totalSolUsd = solanaBalanceRows.reduce(
    (sum, balance) =>
      sum + (Number(balance?.native_balance) || 0) * (Number(balance?.native_price_usd) || 0),
    0,
  );
  const hasPortfolioData =
    wallets.length > 0 &&
    (evmWallets.length === 0 || hasEthUsdData) &&
    (solanaWallets.length === 0 || (hasSolUsdData && hasUsdcBalanceData));
  const totalPortfolioUsd = totalEthUsd + totalSolUsd + totalUsdc;
  const selectedSendWallet = sendAsset === "eth" ? pk : solanaPk;
  const recipientPlaceholder =
    sendAsset === "usdc"
      ? "@handle or Solana wallet address"
      : sendAsset === "sol"
        ? "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgE6y"
        : "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";

  function renderWalletList(items: WalletRecord[], emptyText: string) {
    return (
      <div className="app-wallet-list">
        {walletsQuery.isLoading && <div className="app-wallet-empty">Loading wallets...</div>}
        {!walletsQuery.isLoading && items.length === 0 && (
          <div className="app-wallet-empty">{emptyText}</div>
        )}
        {items.map((wallet) => {
          const balance = walletBalanceById.get(wallet.id);
          const isSolana = wallet.wallet_type === "solana";
          const nativeSymbol = isSolana ? "SOL" : "ETH";
          const nativeUsd = formatUsdEquivalent(balance?.native_balance, balance?.native_price_usd);
          const hasWalletUsdc =
            !isSolana ||
            (balance?.usdc_balance !== null &&
              balance?.usdc_balance !== undefined &&
              Number.isFinite(Number(balance.usdc_balance)));
          const usdcBalance = isSolana && hasWalletUsdc ? Number(balance?.usdc_balance) : 0;
          const walletUsd =
            nativeUsd != null && hasWalletUsdc
              ? Number(balance?.native_balance) * Number(balance?.native_price_usd) + usdcBalance
              : null;
          const balanceStatus = walletBalancesQuery.isLoading
            ? "Loading..."
            : balance?.error || walletBalancesQuery.isError
              ? "Balance unavailable"
              : (formatUsdValue(walletUsd) ?? "--");

          return (
            <div key={wallet.id} className="app-wallet-row" data-primary={wallet.is_primary}>
              <div className="app-wallet-row-top">
                <span
                  className={
                    wallet.is_primary
                      ? "app-wallet-primary-marker app-wallet-primary-marker-active"
                      : "app-wallet-primary-marker"
                  }
                  aria-hidden="true"
                >
                  <Star className="h-5 w-5" fill={wallet.is_primary ? "currentColor" : "none"} />
                </span>
                <CopyableAddressInline
                  value={wallet.address ?? wallet.public_key}
                  copied={copiedKey === `wallet-${wallet.id}`}
                  ariaLabel="Copy wallet address"
                  onCopy={() =>
                    copyText(
                      wallet.address ?? wallet.public_key,
                      "Wallet address",
                      `wallet-${wallet.id}`,
                    )
                  }
                />
              </div>
              <div className="app-wallet-row-balance" data-chain={isSolana ? "solana" : "evm"}>
                <div>
                  <span>{nativeSymbol}</span>
                  <strong className="sm-mono">
                    {formatBalance(balance?.native_balance)} {nativeSymbol}
                  </strong>
                </div>
                {isSolana && (
                  <div>
                    <span>USDC</span>
                    <strong className="sm-mono">{formatBalance(balance?.usdc_balance)} USDC</strong>
                  </div>
                )}
                <small>{balanceStatus}</small>
              </div>
              <div className="app-wallet-row-actions">
                {!wallet.is_primary && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="app-wallet-secondary-action gap-2"
                    disabled={primaryMut.isPending}
                    onClick={() => primaryMut.mutate(wallet.id)}
                  >
                    <Star className="h-3.5 w-3.5" />
                    Make primary
                  </Button>
                )}
                {wallet.is_primary && <span className="app-wallet-primary-pill">Primary</span>}
                <Button
                  variant="outline"
                  size="sm"
                  className="app-wallet-secondary-action gap-2"
                  onClick={() => openExportDialog(wallet)}
                >
                  <KeyRound className="h-3.5 w-3.5" /> Export
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="app-dashboard-page app-wallet-page">
      <header className="app-live-hero app-dashboard-hero app-wallet-hero">
        <div className="app-dashboard-hero-copy">
          <p className="app-live-kicker">Wallet</p>
          <h1>Wallet control center.</h1>
          <p>
            Manage your EVM and Solana wallets for Linkr actions, deposits, and future launches.
          </p>
        </div>
        <div className="app-live-signal" aria-label="Wallet status">
          <span />
          {wallets.length > 0 ? "wallets ready" : "setup needed"}
        </div>
      </header>

      <div className="app-wallet-overview-grid">
        <div className="sm-card app-dashboard-card app-wallet-overview-card">
          <div className="app-wallet-overview-head">
            <div>
              <Wallet className="h-4 w-4" /> Primary EVM deposit address
            </div>
            <QrCode className="h-4 w-4 text-muted-foreground" />
          </div>
          <CopyableAddressBox
            value={pk}
            emptyText="Generate a wallet to receive ETH."
            copied={copiedKey === "primary-evm"}
            ariaLabel="Copy primary EVM address"
            onCopy={() => pk && copyText(pk, "Address", "primary-evm")}
          />
        </div>

        <div className="sm-card app-dashboard-card app-wallet-overview-card">
          <div className="app-wallet-overview-head">
            <div>
              <Wallet className="h-4 w-4" /> Primary Solana address
            </div>
            <QrCode className="h-4 w-4 text-muted-foreground" />
          </div>
          <CopyableAddressBox
            value={solanaPk}
            emptyText="Generate a Solana wallet to receive SOL and SPL tokens."
            copied={copiedKey === "primary-solana"}
            ariaLabel="Copy primary Solana address"
            onCopy={() => solanaPk && copyText(solanaPk, "Solana address", "primary-solana")}
          />
        </div>
      </div>

      <section className="app-wallet-balances-section">
        <div className="app-dashboard-card-head app-dashboard-section-head">
          <div>
            <h2>Wallet balances</h2>
            <p className="app-dashboard-section-copy">
              Collective balances across every wallet in your account.
            </p>
          </div>
          <span className="app-wallet-balance-count">
            {wallets.length} {wallets.length === 1 ? "wallet" : "wallets"}
          </span>
        </div>
        <div className="app-wallet-balance-grid">
          <article className="app-wallet-stat-card" data-asset="eth">
            <div className="app-wallet-stat-head">
              <WalletAssetMark asset="eth" />
              <span>Total ETH</span>
            </div>
            <div className="app-wallet-stat-value">
              <strong className="sm-mono">
                {walletBalancesQuery.isLoading || !hasEthBalanceData
                  ? "--"
                  : formatBalance(totalEth)}
              </strong>
              <span>ETH</span>
            </div>
            <small>{hasEthUsdData ? formatUsdValue(totalEthUsd) : "--"}</small>
          </article>

          <article className="app-wallet-stat-card" data-asset="sol">
            <div className="app-wallet-stat-head">
              <WalletAssetMark asset="sol" />
              <span>Total SOL</span>
            </div>
            <div className="app-wallet-stat-value">
              <strong className="sm-mono">
                {walletBalancesQuery.isLoading || !hasSolBalanceData
                  ? "--"
                  : formatBalance(totalSol)}
              </strong>
              <span>SOL</span>
            </div>
            <small>{hasSolUsdData ? formatUsdValue(totalSolUsd) : "--"}</small>
          </article>

          <article className="app-wallet-stat-card" data-asset="usdc">
            <div className="app-wallet-stat-head">
              <WalletAssetMark asset="usdc" />
              <span>Total USDC</span>
            </div>
            <div className="app-wallet-stat-value">
              <strong className="sm-mono">
                {walletBalancesQuery.isLoading || !hasUsdcBalanceData
                  ? "--"
                  : formatBalance(totalUsdc)}
              </strong>
              <span>USDC</span>
            </div>
            <small>Across {solanaWallets.length} Solana wallets</small>
          </article>

          <article
            className="app-wallet-stat-card app-wallet-stat-portfolio"
            data-asset="portfolio"
          >
            <div className="app-wallet-stat-head">
              <span className="app-wallet-stat-portfolio-mark" aria-hidden="true">
                <Wallet />
              </span>
              <span>Total portfolio</span>
            </div>
            <div className="app-wallet-stat-value">
              <strong className="sm-mono">
                {walletBalancesQuery.isLoading || !hasPortfolioData
                  ? "--"
                  : formatBalance(totalPortfolioUsd, 2)}
              </strong>
              <span>USDC</span>
            </div>
            <small>{hasPortfolioData ? formatUsdValue(totalPortfolioUsd) : "--"}</small>
          </article>
        </div>
      </section>

      <section className="app-wallet-chain-grid">
        <div className="sm-card app-dashboard-card app-wallet-chain-card app-wallet-chain-card-evm">
          <div className="app-wallet-chain-head">
            <div className="app-wallet-chain-title">
              <span className="app-wallet-chain-icon app-wallet-chain-icon-evm" aria-hidden="true">
                <RobinhoodLogo />
              </span>
              <div>
                <h2>EVM wallets</h2>
                <p>Robinhood Chain wallets for ETH deposits and transactions.</p>
              </div>
            </div>
          </div>
          {renderWalletList(evmWallets, "No EVM wallets yet.")}
          <div className="app-wallet-chain-footer">
            <span>
              {evmWallets.length} {evmWallets.length === 1 ? "wallet" : "wallets"}
            </span>
            <WalletAddMenu
              chain="evm"
              pending={createWalletMut.isPending}
              onCreate={() => createWalletMut.mutate("evm")}
              onImport={() => setImportChain("evm")}
            />
          </div>
        </div>

        <div className="sm-card app-dashboard-card app-wallet-chain-card app-wallet-chain-card-solana">
          <div className="app-wallet-chain-head">
            <div className="app-wallet-chain-title">
              <span
                className="app-wallet-chain-icon app-wallet-chain-icon-solana"
                aria-hidden="true"
              >
                <SolanaLogo />
              </span>
              <div>
                <h2>Solana wallets</h2>
                <p>Solana wallets for SOL, SPL tokens, and launch rewards.</p>
              </div>
            </div>
          </div>
          {renderWalletList(solanaWallets, "No Solana wallets yet.")}
          <div className="app-wallet-chain-footer">
            <span>
              {solanaWallets.length} {solanaWallets.length === 1 ? "wallet" : "wallets"}
            </span>
            <WalletAddMenu
              chain="solana"
              pending={createWalletMut.isPending}
              onCreate={() => createWalletMut.mutate("solana")}
              onImport={() => setImportChain("solana")}
            />
          </div>
        </div>
      </section>

      <AlertDialog open={importChain !== null} onOpenChange={closeImportDialog}>
        <AlertDialogContent className="app-dashboard-modal app-wallet-import-modal">
          <AlertDialogHeader className="app-dashboard-modal-header">
            <AlertDialogTitle>
              Import {importChain === "solana" ? "Solana" : "EVM"} wallet
            </AlertDialogTitle>
            <AlertDialogDescription>
              Paste the private key for the wallet you want to add. It is encrypted immediately and
              is never shown again after import.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="app-dashboard-modal-body">
            <div className="app-dashboard-modal-warning">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              <div>
                <strong>Keep this key private</strong>
                <p>Only import on a device you trust. Linkr staff will never ask for this key.</p>
              </div>
            </div>
            <div className="app-dashboard-modal-field">
              <Label htmlFor="wallet-import-key">Private key</Label>
              <div className="app-wallet-import-key-field">
                <Input
                  id="wallet-import-key"
                  type={showImportPrivateKey ? "text" : "password"}
                  value={importPrivateKey}
                  onChange={(event) => {
                    setImportPrivateKey(event.target.value);
                    if (importError) setImportError(null);
                  }}
                  placeholder={
                    importChain === "solana"
                      ? "Base58 key or [64-byte JSON array]"
                      : "0x-prefixed private key"
                  }
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  disabled={importPending}
                />
                <button
                  type="button"
                  aria-label={showImportPrivateKey ? "Hide private key" : "Show private key"}
                  onClick={() => setShowImportPrivateKey((value) => !value)}
                >
                  {showImportPrivateKey ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              <p className="app-dashboard-modal-hint">
                {importChain === "solana"
                  ? "Supports standard base58 Solana keys and 64-byte JSON key arrays."
                  : "Supports a 32-byte hexadecimal EVM private key, with or without 0x."}
              </p>
              {importError && (
                <p className="app-wallet-import-error" role="alert">
                  {importError}
                </p>
              )}
            </div>
          </div>
          <AlertDialogFooter className="app-dashboard-modal-footer">
            <AlertDialogCancel disabled={importPending}>Cancel</AlertDialogCancel>
            <Button
              onClick={submitWalletImport}
              disabled={!importPrivateKey.trim() || importPending}
              className="gap-2"
            >
              {importPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <KeyRound className="h-4 w-4" />
              )}
              {importPending ? "Importing..." : "Import wallet"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {wallets.length > 0 && (
        <AlertDialog open={exportDialogOpen} onOpenChange={resetExportDialog}>
          <AlertDialogContent className="app-dashboard-modal app-wallet-export-modal">
            <AlertDialogHeader className="app-dashboard-modal-header">
              <AlertDialogTitle>Export private key</AlertDialogTitle>
              <AlertDialogDescription>
                This reveals the{" "}
                {selectedExportType === "solana" ? "Solana secret key" : "EVM private key"} for{" "}
                {selectedExportAddress ? shortAddress(selectedExportAddress, 6, 6) : "this wallet"}.
                Anyone who gets it can move every asset in this wallet.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="app-dashboard-modal-body">
              <div className="app-dashboard-modal-warning">
                <ShieldAlert className="h-4 w-4 shrink-0" />
                <div>
                  <strong>Check your surroundings first.</strong>
                  <p>
                    Do not paste this key into a website you do not trust. Linkr support will never
                    ask for it.
                  </p>
                </div>
              </div>

              {keyExport ? (
                <div className="app-dashboard-modal-vault">
                  <div className="app-dashboard-modal-vault-head">
                    <div>
                      <strong>Secure export vault</strong>
                      <span>Exported {new Date(keyExport.exported_at).toLocaleString()}</span>
                    </div>
                    <Badge variant="outline" className="app-dashboard-modal-timer">
                      <TimerReset className="h-3.5 w-3.5" />
                      Clears in {secondsRemaining}s
                    </Badge>
                  </div>

                  <div className="app-dashboard-modal-actions">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowSecret((value) => !value)}
                      className="app-dashboard-modal-secondary gap-2"
                    >
                      {showSecret ? (
                        <EyeOff className="h-3.5 w-3.5" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                      {showSecret ? "Hide" : "Show"}
                    </Button>
                    <button
                      type="button"
                      onClick={() => copyText(privateKeyText, "Private key", "private-key")}
                      className="app-address-copy-button app-dashboard-modal-icon-button app-dashboard-modal-secondary"
                      aria-label={
                        copiedKey === "private-key" ? "Private key copied" : "Copy private key"
                      }
                      title={copiedKey === "private-key" ? "Copied" : "Copy to clipboard"}
                      data-copied={copiedKey === "private-key"}
                    >
                      <CopyGlyph copied={copiedKey === "private-key"} />
                    </button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={downloadPrivateKey}
                      className="app-dashboard-modal-secondary gap-2"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download
                    </Button>
                  </div>

                  <div className="app-dashboard-modal-field">
                    <Label>{exportedKeyLabel}</Label>
                    <Textarea
                      readOnly
                      value={displayedPrivateKey}
                      className="sm-mono app-dashboard-modal-secret"
                    />
                  </div>
                </div>
              ) : (
                <div className="app-dashboard-modal-form">
                  <div
                    className="app-wallet-export-checkpoint rounded-xl border border-primary/20 bg-primary/[0.04] p-4"
                    aria-live="polite"
                  >
                    <div className="app-wallet-export-checkpoint-head flex items-start gap-3">
                      <div className="relative mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
                        {exportAuthStage === "waiting" || exportAuthStage === "syncing" ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <ShieldCheck className="h-4 w-4" />
                        )}
                        {exportAuthStage === "waiting" && (
                          <span className="absolute inset-0 animate-ping rounded-full border border-primary/50" />
                        )}
                      </div>
                      <div className="app-wallet-export-checkpoint-copy min-w-0 flex-1">
                        <strong className="text-sm">X identity checkpoint</strong>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {exportAuthStage === "waiting" &&
                            "The secure window is open. This dialog is listening for X to confirm you."}
                          {exportAuthStage === "syncing" &&
                            "X approved. Verifying the refreshed Linkr session..."}
                          {exportAuthStage === "exporting" &&
                            "Identity matched. Creating a one-time wallet challenge..."}
                          {exportAuthStage === "error" && exportAuthError}
                          {exportAuthStage === "ready" &&
                            "After the safety check below, a compact X window will verify it is really you."}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className="app-wallet-export-checkpoint-status shrink-0 border-primary/30 bg-background"
                      >
                        {exportAuthStage === "waiting"
                          ? "Listening"
                          : exportAuthStage === "syncing"
                            ? "Checking"
                            : exportAuthStage === "exporting"
                              ? "Unlocking"
                              : exportAuthStage === "error"
                                ? "Retry"
                                : "Required"}
                      </Badge>
                    </div>
                    <div className="app-wallet-export-progress mt-4 grid grid-cols-3 gap-2 text-[11px]">
                      <ExportProgressStep
                        number="1"
                        label="Safety check"
                        active={!canExportPrivateKey}
                        complete={canExportPrivateKey}
                      />
                      <ExportProgressStep
                        number="2"
                        label="X verification"
                        active={exportAuthStage === "waiting" || exportAuthStage === "syncing"}
                        complete={exportAuthStage === "exporting"}
                      />
                      <ExportProgressStep
                        number="3"
                        label="Secure reveal"
                        active={exportAuthStage === "exporting"}
                        complete={false}
                      />
                    </div>
                  </div>

                  <div className="app-dashboard-modal-field">
                    <Label htmlFor="private-key-confirm">Type EXPORT to continue</Label>
                    <Input
                      id="private-key-confirm"
                      value={exportPhrase}
                      onChange={(event) => setExportPhrase(event.target.value)}
                      autoComplete="off"
                      disabled={
                        exportAuthStage === "waiting" ||
                        exportAuthStage === "syncing" ||
                        exportAuthStage === "exporting"
                      }
                      className="sm-mono"
                    />
                  </div>

                  <label htmlFor="private-key-ack" className="app-dashboard-modal-ack">
                    <Checkbox
                      id="private-key-ack"
                      checked={exportAcknowledged}
                      onCheckedChange={(checked) => setExportAcknowledged(checked === true)}
                      disabled={
                        exportAuthStage === "waiting" ||
                        exportAuthStage === "syncing" ||
                        exportAuthStage === "exporting"
                      }
                    />
                    <span>
                      I understand that this key controls the wallet and I am exporting it on a
                      private device.
                    </span>
                  </label>
                </div>
              )}
            </div>

            <AlertDialogFooter className="app-dashboard-modal-footer">
              <AlertDialogCancel
                className="app-dashboard-modal-secondary"
                disabled={
                  exportMut.isPending ||
                  exportAuthStage === "syncing" ||
                  exportAuthStage === "exporting"
                }
              >
                {keyExport ? "Close and clear" : "Cancel"}
              </AlertDialogCancel>
              {!keyExport && (
                <Button
                  onClick={reauthenticateWalletExport}
                  disabled={
                    !canExportPrivateKey ||
                    exportAuthStage === "waiting" ||
                    exportAuthStage === "syncing" ||
                    exportAuthStage === "exporting" ||
                    exportMut.isPending
                  }
                  className="app-dashboard-modal-primary gap-2"
                >
                  {exportAuthStage === "waiting" ||
                  exportAuthStage === "syncing" ||
                  exportAuthStage === "exporting" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-4 w-4" />
                  )}
                  {exportAuthStage === "waiting"
                    ? "Waiting for X..."
                    : exportAuthStage === "syncing"
                      ? "Verifying session..."
                      : exportAuthStage === "exporting"
                        ? "Unlocking key..."
                        : exportAuthStage === "error"
                          ? "Try X verification again"
                          : "Verify with X & reveal"}
                </Button>
              )}
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {(pk || solanaPk) && (
        <section className="sm-card app-dashboard-card app-wallet-action-card app-wallet-transfer-card">
          <header className="app-wallet-action-head">
            <div className="app-wallet-action-title">
              <span className="app-wallet-action-icon" aria-hidden="true">
                <Send />
              </span>
              <div>
                <span>Direct transfer</span>
                <h2>Send ETH, SOL, or USDC</h2>
                <p>
                  Choose an asset, set the destination, and review the sending wallet in one pass.
                </p>
              </div>
            </div>
            <span className="app-wallet-action-network">
              {sendAsset === "eth" ? "Robinhood Chain" : "Solana"}
            </span>
          </header>

          <div className="app-wallet-transfer-composer">
            <div className="app-wallet-transfer-asset">
              <Label>Asset to send</Label>
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="app-wallet-action-menu-trigger"
                    aria-label="Choose transfer asset"
                  >
                    <WalletAssetMark asset={sendAsset} />
                    <span>
                      <strong>{sendUnit}</strong>
                      <small>{sendAsset === "eth" ? "Robinhood Chain" : "Solana"}</small>
                    </span>
                    <ChevronDown aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  sideOffset={8}
                  className="app-wallet-action-menu"
                >
                  {(["eth", "sol", "usdc"] as const).map((asset) => (
                    <DropdownMenuItem
                      key={asset}
                      onSelect={() => setSendAsset(asset)}
                      className="app-wallet-action-menu-item"
                    >
                      <WalletAssetMark asset={asset} />
                      <span>
                        <strong>{asset.toUpperCase()}</strong>
                        <small>{asset === "eth" ? "Robinhood Chain" : "Solana"}</small>
                      </span>
                      {sendAsset === asset && <Check aria-hidden="true" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="app-wallet-transfer-fields">
              <div className="app-wallet-action-field app-wallet-transfer-recipient">
                <Label htmlFor="r">
                  {sendAsset === "usdc" ? "Wallet address or X handle" : "Recipient address"}
                </Label>
                <Input
                  id="r"
                  value={recipient}
                  onChange={(event) => setRecipient(event.target.value)}
                  placeholder={recipientPlaceholder}
                  className="sm-mono"
                />
              </div>
              <div className="app-wallet-action-field app-wallet-transfer-amount">
                <Label htmlFor="a">Amount</Label>
                <div>
                  <Input
                    id="a"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    placeholder={
                      sendAsset === "usdc" ? "25.00" : sendAsset === "sol" ? "0.25" : "0.10"
                    }
                    inputMode="decimal"
                  />
                  <span>{sendUnit}</span>
                </div>
              </div>
            </div>
          </div>

          <footer className="app-wallet-action-foot">
            <div className="app-wallet-action-source">
              <span>Sending from</span>
              <strong className="sm-mono">
                {selectedSendWallet ? shortAddress(selectedSendWallet, 7, 5) : "Wallet required"}
              </strong>
            </div>
            <div className="app-wallet-action-route" aria-hidden="true">
              <span />
              <ArrowRight />
              <span />
            </div>
            <Button
              onClick={() => sendMut.mutate()}
              disabled={!selectedSendWallet || !recipient || !amount || sendMut.isPending}
              className="app-wallet-action-submit gap-2"
            >
              {sendMut.isPending ? <Loader2 className="animate-spin" /> : <Send />}
              {sendMut.isPending ? "Sending..." : `Send ${sendUnit}`}
            </Button>
          </footer>
          {!selectedSendWallet && (
            <p className="app-wallet-action-note">
              Add a primary {sendAsset === "eth" ? "EVM" : "Solana"} wallet before sending{" "}
              {sendUnit}.
            </p>
          )}
        </section>
      )}

      {solanaPk && (
        <section className="sm-card app-dashboard-card app-wallet-action-card app-wallet-swap-card">
          <header className="app-wallet-action-head">
            <div className="app-wallet-action-title">
              <span className="app-wallet-action-icon" aria-hidden="true">
                <ArrowDownUp />
              </span>
              <div>
                <span>Solana conversion</span>
                <h2>Swap SOL and USDC</h2>
                <p>Your Rules settings apply automatically to every conversion.</p>
              </div>
            </div>
            <span className="app-wallet-action-network">Primary Solana wallet</span>
          </header>

          <div className="app-wallet-swap-ticket">
            <div className="app-wallet-swap-side app-wallet-swap-input-side">
              <span>You send</span>
              <div className="app-wallet-swap-asset-name">
                <WalletAssetMark asset={swapDirection === "sol_to_usdc" ? "sol" : "usdc"} />
                <strong>{swapDirection === "sol_to_usdc" ? "SOL" : "USDC"}</strong>
              </div>
              <Input
                id="swap-amount"
                aria-label={`Input amount in ${swapDirection === "sol_to_usdc" ? "SOL" : "USDC"}`}
                value={swapAmount}
                onChange={(event) => setSwapAmount(event.target.value)}
                placeholder={swapDirection === "sol_to_usdc" ? "0.25" : "25.00"}
                inputMode="decimal"
              />
            </div>

            <div className="app-wallet-swap-direction">
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <button type="button" aria-label="Change swap direction">
                    <ArrowRight />
                    <small>Route</small>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="center"
                  sideOffset={8}
                  className="app-wallet-action-menu app-wallet-swap-menu"
                >
                  <DropdownMenuItem
                    onSelect={() => setSwapDirection("sol_to_usdc")}
                    className="app-wallet-action-menu-item"
                  >
                    <WalletAssetMark asset="sol" />
                    <span>
                      <strong>SOL → USDC</strong>
                      <small>Sell SOL for USDC</small>
                    </span>
                    {swapDirection === "sol_to_usdc" && <Check aria-hidden="true" />}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => setSwapDirection("usdc_to_sol")}
                    className="app-wallet-action-menu-item"
                  >
                    <WalletAssetMark asset="usdc" />
                    <span>
                      <strong>USDC → SOL</strong>
                      <small>Buy SOL with USDC</small>
                    </span>
                    {swapDirection === "usdc_to_sol" && <Check aria-hidden="true" />}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="app-wallet-swap-side app-wallet-swap-output-side">
              <span>You receive</span>
              <div className="app-wallet-swap-asset-name">
                <WalletAssetMark asset={swapDirection === "sol_to_usdc" ? "usdc" : "sol"} />
                <strong>{swapDirection === "sol_to_usdc" ? "USDC" : "SOL"}</strong>
              </div>
              <div className="app-wallet-swap-market-output">
                <strong>Market rate</strong>
                <small>Final output is set at execution</small>
              </div>
            </div>
          </div>

          <footer className="app-wallet-action-foot app-wallet-swap-foot">
            <div className="app-wallet-action-source">
              <span>Trading wallet</span>
              <strong className="sm-mono">{shortAddress(solanaPk, 7, 5)}</strong>
            </div>
            <div className="app-wallet-swap-protection">
              <ShieldCheck aria-hidden="true" />
              Rules protected
            </div>
            <Button
              onClick={() => swapMut.mutate()}
              disabled={!swapAmount || swapMut.isPending}
              className="app-wallet-action-submit gap-2"
            >
              {swapMut.isPending ? <Loader2 className="animate-spin" /> : <ArrowDownUp />}
              {swapMut.isPending ? "Swapping..." : "Review swap"}
            </Button>
          </footer>
        </section>
      )}

      <section className="sm-card app-dashboard-card app-wallet-transaction-list app-wallet-transactions">
        <div className="app-dashboard-card-head app-dashboard-section-head">
          <div>
            <h2>Transaction history</h2>
            <p className="app-dashboard-section-copy">
              Recent ETH, SOL, and USDC transfers, swaps, and wallet actions from Linkr.
            </p>
          </div>
        </div>
        <div className="app-wallet-transaction-feed">
          {(txQuery.data ?? []).length === 0 && (
            <div className="app-dashboard-empty">No transactions yet.</div>
          )}
          {(txQuery.data ?? []).map((tx) => (
            <div key={tx.id} className="app-dashboard-activity-row">
              <div>
                <strong>{tx.action ?? "--"}</strong>
                <p className="app-dashboard-section-copy">
                  {tx.created_at ? new Date(tx.created_at).toLocaleString() : "--"}
                </p>
              </div>
              <div className="text-right">
                <div className="sm-mono">
                  {formatTxAmount(tx)} {tx.native_symbol ?? (tx.amount_sol != null ? "SOL" : "ETH")}
                </div>
                <div className="sm-mono text-xs text-muted-foreground">
                  {shortAddress(tx.tx_hash ?? tx.tx_signature)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

async function waitForFreshLinkrSession(
  expectedUserId: string | null,
  previousAccessToken: string | null,
  timeoutMs = 8_000,
): Promise<string | null> {
  if (!expectedUserId || !previousAccessToken) return null;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const { data, error } = await supabase.auth.getSession();
    const session = data.session;
    if (
      !error &&
      session?.user.id === expectedUserId &&
      session.access_token !== previousAccessToken
    ) {
      return session.user.id;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }

  return null;
}

class SessionExpiredError extends Error {
  constructor() {
    super("Your Linkr session expired. Sign in again, then retry.");
    this.name = "SessionExpiredError";
  }
}

function functionResponseStatus(error: unknown): number | null {
  const status = Number((error as { context?: { status?: number } })?.context?.status);
  return Number.isFinite(status) ? status : null;
}

async function invokeAuthenticatedFunction<T>(functionName: string, body: Record<string, unknown>) {
  const current = await supabase.auth.getSession();
  const currentToken = current.data.session?.access_token;
  if (current.error || !currentToken) throw new SessionExpiredError();

  const invoke = (token: string) =>
    supabase.functions.invoke<T>(functionName, {
      body,
      headers: { Authorization: `Bearer ${token}` },
    });
  const first = await invoke(currentToken);
  if (!first.error || functionResponseStatus(first.error) !== 401) return first;

  const refreshed = await supabase.auth.refreshSession();
  const refreshedToken = refreshed.data.session?.access_token;
  if (refreshed.error || !refreshedToken) throw new SessionExpiredError();

  const retried = await invoke(refreshedToken);
  if (retried.error && functionResponseStatus(retried.error) === 401) {
    throw new SessionExpiredError();
  }
  return retried;
}

async function installWalletExportSession(
  handoffCode: string,
  redirectTo: string,
): Promise<string | null> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  if (!supabaseUrl) return null;
  const redirectUrl = new URL(redirectTo);
  if (redirectUrl.origin !== window.location.origin || redirectUrl.pathname !== "/auth/callback") {
    return null;
  }
  const response = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/functions/v1/x-oauth/handoff`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      handoff_code: handoffCode,
      redirect_to: redirectUrl.toString(),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.access_token || !payload?.refresh_token) return null;
  const { data, error } = await supabase.auth.setSession({
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
  });
  return error ? null : (data.session?.user.id ?? null);
}

function openCenteredAuthPopup(url: string): Window | null {
  const width = 480;
  const height = 720;
  const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
  const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);
  return window.open(
    url,
    "linkr_x_wallet_export",
    [
      "popup=yes",
      `width=${width}`,
      `height=${height}`,
      `left=${Math.round(left)}`,
      `top=${Math.round(top)}`,
      "menubar=no",
      "toolbar=no",
      "location=no",
      "directories=no",
      "status=no",
      "titlebar=no",
      "resizable=yes",
      "scrollbars=yes",
    ].join(","),
  );
}

function WalletAssetMark({ asset }: { asset: "eth" | "sol" | "usdc" }) {
  return (
    <span className="app-wallet-asset-mark" data-asset={asset} aria-hidden="true">
      {asset === "eth" ? (
        <RobinhoodLogo />
      ) : asset === "sol" ? (
        <SolanaLogo />
      ) : (
        <img src="/linkr/usdc.webp" alt="" />
      )}
    </span>
  );
}

function WalletAddMenu({
  chain,
  pending,
  onCreate,
  onImport,
}: {
  chain: WalletChain;
  pending: boolean;
  onCreate: () => void;
  onImport: () => void;
}) {
  const label = chain === "solana" ? "Solana" : "EVM";
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          disabled={pending}
          className="app-wallet-chain-add gap-2"
          aria-label={`Add ${label} wallet`}
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add wallet
          <ChevronDown className="h-3.5 w-3.5 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="app-wallet-add-menu">
        <DropdownMenuItem onSelect={onCreate} className="app-wallet-add-menu-item">
          <Plus className="h-4 w-4" />
          <span>
            <strong>Create new wallet</strong>
            <small>Generate a new encrypted {label} wallet</small>
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onImport} className="app-wallet-add-menu-item">
          <KeyRound className="h-4 w-4" />
          <span>
            <strong>Import wallet</strong>
            <small>Add a wallet using its private key</small>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function createAuthFlowId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function ExportProgressStep({
  number,
  label,
  active,
  complete,
}: {
  number: string;
  label: string;
  active: boolean;
  complete: boolean;
}) {
  return (
    <div
      className={`app-wallet-export-progress-step flex items-center gap-1.5 rounded-lg border px-2 py-2 transition-colors ${
        active || complete
          ? "border-primary/30 bg-background text-foreground"
          : "border-border/60 text-muted-foreground"
      }`}
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${
          complete
            ? "bg-primary text-primary-foreground"
            : active
              ? "bg-foreground text-background"
              : "bg-muted text-muted-foreground"
        }`}
      >
        {complete ? <Check className="h-2.5 w-2.5" /> : number}
      </span>
      <span className="truncate">{label}</span>
    </div>
  );
}

function maskSecret(value: string) {
  if (!value) return "";
  if (value.length <= 16) return "*".repeat(value.length);
  return `${value.slice(0, 8)}${"*".repeat(Math.min(48, value.length - 16))}${value.slice(-8)}`;
}

function CopyGlyph({ copied }: { copied: boolean }) {
  return copied ? (
    <Check aria-hidden="true" className="h-4 w-4" />
  ) : (
    <Copy aria-hidden="true" className="h-4 w-4" />
  );
}

function CopyableAddressBox({
  value,
  emptyText,
  copied,
  ariaLabel,
  onCopy,
}: {
  value: string | null;
  emptyText: string;
  copied: boolean;
  ariaLabel: string;
  onCopy: () => void;
}) {
  return (
    <div className="app-wallet-address-box">
      <div className="sm-mono">{value ?? emptyText}</div>
      {value && (
        <button
          type="button"
          className="app-address-copy-button"
          aria-label={ariaLabel}
          data-copied={copied}
          onClick={onCopy}
        >
          <CopyGlyph copied={copied} />
        </button>
      )}
    </div>
  );
}

function CopyableAddressInline({
  value,
  copied,
  ariaLabel,
  onCopy,
}: {
  value: string;
  copied: boolean;
  ariaLabel: string;
  onCopy: () => void;
}) {
  return (
    <div className="app-wallet-list-address">
      <span className="sm-mono" title={value}>
        {value}
      </span>
      <button
        type="button"
        className="app-address-copy-button"
        aria-label={ariaLabel}
        data-copied={copied}
        onClick={onCopy}
      >
        <CopyGlyph copied={copied} />
      </button>
    </div>
  );
}

function formatTxAmount(tx: WalletTransaction) {
  const unit = tx.native_symbol ?? (tx.amount_sol != null ? "SOL" : "ETH");
  const value =
    unit === "USDC" ? tx.amount_original : unit === "SOL" ? tx.amount_sol : tx.amount_eth;
  return Number(value ?? 0).toLocaleString(undefined, {
    maximumFractionDigits: 9,
  });
}
