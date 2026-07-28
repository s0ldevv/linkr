export type LaunchAuthorizationDecision =
  | { kind: "auto_authorized"; reasonCode: "explicit_launch_intent" }
  | {
    kind: "confirmation_required";
    reasonCode:
      | "profile_requires_confirmation"
      | "exception_requires_confirmation";
  }
  | {
    kind: "clarification_required";
    reasonCode:
      | "launch_name_missing"
      | "explicit_chain_missing"
      | "explicit_launch_intent_missing"
      | "wallet_missing"
      | "dev_buy_invalid"
      | "dev_buy_exceeds_cap";
  };

export function decideLaunchAuthorization(args: {
  explicitLaunchIntent: boolean;
  name: unknown;
  chain: unknown;
  chainProvenance: unknown;
  walletId: unknown;
  devBuyAmount: unknown;
  maximumAutoDevBuy: unknown;
  requireConfirmationForAll: boolean;
  exceptionalIrreversibleOptions?: boolean;
}): LaunchAuthorizationDecision {
  if (!String(args.name ?? "").trim()) {
    return {
      kind: "clarification_required",
      reasonCode: "launch_name_missing",
    };
  }
  if (
    (args.chain !== "solana" && args.chain !== "robinhood") ||
    !["user_text", "thread_context"].includes(
      String(args.chainProvenance ?? ""),
    )
  ) {
    return {
      kind: "clarification_required",
      reasonCode: "explicit_chain_missing",
    };
  }
  if (!args.explicitLaunchIntent) {
    return {
      kind: "clarification_required",
      reasonCode: "explicit_launch_intent_missing",
    };
  }
  if (!String(args.walletId ?? "").trim()) {
    return { kind: "clarification_required", reasonCode: "wallet_missing" };
  }
  const amount = Number(args.devBuyAmount ?? 0);
  const cap = Number(args.maximumAutoDevBuy ?? 0);
  if (
    !Number.isFinite(amount) || amount < 0 || !Number.isFinite(cap) || cap < 0
  ) {
    return { kind: "clarification_required", reasonCode: "dev_buy_invalid" };
  }
  if (amount > cap) {
    return {
      kind: "clarification_required",
      reasonCode: "dev_buy_exceeds_cap",
    };
  }
  if (args.requireConfirmationForAll) {
    return {
      kind: "confirmation_required",
      reasonCode: "profile_requires_confirmation",
    };
  }
  if (args.exceptionalIrreversibleOptions) {
    return {
      kind: "confirmation_required",
      reasonCode: "exception_requires_confirmation",
    };
  }
  return { kind: "auto_authorized", reasonCode: "explicit_launch_intent" };
}
