// deno-lint-ignore-file no-explicit-any
// Deterministic validators. AI cannot bypass these.

import { isEvmAddress } from "./robinhood_chain.ts";
import { isSolanaAddress, normalizeSolanaAddress } from "./market_data/chains.ts";
import { normalizeLaunchMetadataOverrides } from "./launch_metadata.ts";
import { SINGLE_SIDED_LAUNCH_NAME_MAX_LENGTH } from "./robinhood_launch/constants.ts";

export interface ValidationResult {
  valid: boolean;
  requires_confirmation: boolean;
  errors: string[];
  warnings: string[];
  normalized_action: any;
  reply_code?: string;
}

export function validateBuy(args: {
  extraction: any;
  amount: {
    amount_eth: number | null;
    amount_usd: number | null;
    amount_original_unit: string | null;
  };
  threadMints: string[];
  profile: any;
  ethBalance: number;
}): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let requires_confirmation = false;

  const slippage = Number(args.profile?.default_slippage_bps ?? 0);
  const maxBuy = Number(args.profile?.max_auto_buy_eth ?? 0);

  if (slippage <= 0)
    return {
      valid: false,
      requires_confirmation: false,
      errors: ["missing_slippage"],
      warnings,
      normalized_action: null,
      reply_code: "missingSlippage",
    };
  if (maxBuy <= 0)
    return {
      valid: false,
      requires_confirmation: false,
      errors: ["missing_max_buy"],
      warnings,
      normalized_action: null,
      reply_code: "missingMaxBuy",
    };

  let tokenAddress: string | null =
    args.extraction?.token_address ?? args.extraction?.token_mint ?? null;
  let addressSource = tokenAddress ? "current_tweet" : null;
  const candidates: string[] = Array.isArray(args.extraction?.token_candidates)
    ? args.extraction.token_candidates
    : [];
  const fromThread =
    tokenAddress == null && args.threadMints.length === 1 ? args.threadMints[0] : null;
  if (!tokenAddress && fromThread) {
    tokenAddress = fromThread;
    addressSource = "thread_context";
    requires_confirmation = true;
  }
  if (!tokenAddress && candidates.length > 1) {
    return {
      valid: false,
      requires_confirmation: false,
      errors: ["multiple_tokens"],
      warnings,
      normalized_action: null,
      reply_code: "multipleTokens",
    };
  }
  if (!tokenAddress && args.threadMints.length > 1) {
    return {
      valid: false,
      requires_confirmation: false,
      errors: ["multiple_tokens"],
      warnings,
      normalized_action: null,
      reply_code: "multipleTokens",
    };
  }
  if (!tokenAddress)
    return {
      valid: false,
      requires_confirmation: false,
      errors: ["missing_token"],
      warnings,
      normalized_action: null,
      reply_code: "contractAddressRequired",
    };
  if (!isEvmAddress(tokenAddress))
    return {
      valid: false,
      requires_confirmation: false,
      errors: ["bad_token_address"],
      warnings,
      normalized_action: null,
      reply_code: "contractAddressRequired",
    };

  const unit = String(args.amount.amount_original_unit ?? "").toLowerCase();
  if (unit && unit !== "eth" && unit !== "usd") {
    return {
      valid: false,
      requires_confirmation: false,
      errors: ["unsupported_buy_amount_unit"],
      warnings,
      normalized_action: null,
      reply_code: "missingAmount",
    };
  }

  if (args.amount.amount_eth == null) {
    return {
      valid: false,
      requires_confirmation: false,
      errors: ["missing_amount"],
      warnings,
      normalized_action: null,
      reply_code: "missingAmount",
    };
  }
  if (args.amount.amount_eth > args.ethBalance) {
    return {
      valid: false,
      requires_confirmation: false,
      errors: ["insufficient"],
      warnings,
      normalized_action: null,
      reply_code: "insufficient",
    };
  }
  if (args.amount.amount_eth > maxBuy) requires_confirmation = true;
  if (args.profile?.require_confirmation_for_all_tx) requires_confirmation = true;

  return {
    valid: true,
    requires_confirmation,
    errors,
    warnings,
    normalized_action: {
      intent: "buy_token",
      chain: "robinhood",
      output_mint: tokenAddress,
      token_address: tokenAddress,
      address_source: addressSource,
      input_asset: "native_eth",
      amount_eth: args.amount.amount_eth,
      amount_usd: args.amount.amount_usd,
      amount_original: args.extraction?.amount_original ?? null,
      amount_original_unit: args.extraction?.amount_original_unit ?? null,
      eth_price_usd: (args.amount as any).eth_price_usd ?? null,
      slippage_bps: slippage,
    },
  };
}

export function validateSolanaBuy(args: {
  extraction: any;
  amount: {
    amount_sol?: number | null;
    amount_usd: number | null;
    amount_original_unit: string | null;
  };
  threadMints: string[];
  profile: any;
  solBalance: number;
}): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let requires_confirmation = false;

  const slippage = Number(args.profile?.default_slippage_bps ?? 0);
  const maxBuy = Number(args.profile?.max_auto_buy_sol ?? 0);

  if (slippage <= 0)
    return {
      valid: false,
      requires_confirmation: false,
      errors: ["missing_slippage"],
      warnings,
      normalized_action: null,
      reply_code: "missingSlippage",
    };
  if (maxBuy <= 0)
    return {
      valid: false,
      requires_confirmation: false,
      errors: ["missing_max_buy_sol"],
      warnings,
      normalized_action: null,
      reply_code: "missingMaxBuy",
    };

  let tokenMint: string | null = normalizeSolanaAddress(
    args.extraction?.token_mint ?? args.extraction?.token_address ?? null,
  );
  let addressSource = tokenMint ? "current_tweet" : null;
  const candidates: string[] = Array.isArray(args.extraction?.token_candidates)
    ? args.extraction.token_candidates
        .map((item: unknown) => normalizeSolanaAddress(item))
        .filter((item: string | null): item is string => !!item)
    : [];
  const threadSolanaMints = args.threadMints
    .map((item) => normalizeSolanaAddress(item))
    .filter((item: string | null): item is string => !!item);
  if (!tokenMint && candidates.length === 1) {
    tokenMint = candidates[0];
    addressSource = "current_tweet";
  }
  if (!tokenMint && threadSolanaMints.length === 1) {
    tokenMint = threadSolanaMints[0];
    addressSource = "thread_context";
    requires_confirmation = true;
  }
  if (!tokenMint && (candidates.length > 1 || threadSolanaMints.length > 1)) {
    return {
      valid: false,
      requires_confirmation: false,
      errors: ["multiple_tokens"],
      warnings,
      normalized_action: null,
      reply_code: "multipleTokens",
    };
  }
  if (!tokenMint)
    return {
      valid: false,
      requires_confirmation: false,
      errors: ["missing_token"],
      warnings,
      normalized_action: null,
      reply_code: "solanaMintRequired",
    };

  const unit = String(args.amount.amount_original_unit ?? "").toLowerCase();
  if (unit && unit !== "sol" && unit !== "usd") {
    return {
      valid: false,
      requires_confirmation: false,
      errors: ["unsupported_buy_amount_unit"],
      warnings,
      normalized_action: null,
      reply_code: "missingAmount",
    };
  }

  const amountSol = args.amount.amount_sol ?? null;
  if (amountSol == null) {
    return {
      valid: false,
      requires_confirmation: false,
      errors: ["missing_amount"],
      warnings,
      normalized_action: null,
      reply_code: "missingAmount",
    };
  }
  if (amountSol > args.solBalance) {
    return {
      valid: false,
      requires_confirmation: false,
      errors: ["insufficient"],
      warnings,
      normalized_action: null,
      reply_code: "insufficient",
    };
  }
  if (amountSol > maxBuy) requires_confirmation = true;
  if (args.profile?.require_confirmation_for_all_tx) requires_confirmation = true;

  return {
    valid: true,
    requires_confirmation,
    errors,
    warnings,
    normalized_action: {
      intent: "buy_token",
      chain: "solana",
      output_mint: tokenMint,
      token_address: tokenMint,
      address_source: addressSource,
      input_asset: "native_sol",
      amount_sol: amountSol,
      amount_usd: args.amount.amount_usd,
      amount_original: args.extraction?.amount_original ?? null,
      amount_original_unit: args.extraction?.amount_original_unit ?? null,
      sol_price_usd: (args.amount as any).sol_price_usd ?? null,
      slippage_bps: slippage,
    },
  };
}

export function validateSell(args: {
  extraction: any;
  profile: any;
  ownsToken: boolean;
  resolvedMint: string | null;
}): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let requires_confirmation = false;
  const slippage = Number(args.profile?.default_slippage_bps ?? 0);
  const maxSellPct = Number(args.profile?.max_auto_sell_percent ?? 0);
  if (slippage <= 0)
    return {
      valid: false,
      requires_confirmation: false,
      errors: ["missing_slippage"],
      warnings,
      normalized_action: null,
      reply_code: "missingSlippage",
    };
  if (maxSellPct <= 0)
    return {
      valid: false,
      requires_confirmation: false,
      errors: ["missing_max_sell"],
      warnings,
      normalized_action: null,
      reply_code: "missingMaxSell",
    };
  if (!args.resolvedMint || !isEvmAddress(args.resolvedMint))
    return {
      valid: false,
      requires_confirmation: false,
      errors: ["missing_token"],
      warnings,
      normalized_action: null,
      reply_code: "missingToken",
    };
  if (!args.ownsToken)
    return {
      valid: false,
      requires_confirmation: false,
      errors: ["no_position"],
      warnings,
      normalized_action: null,
      reply_code: "insufficient",
    };

  const unit = args.extraction?.amount_original_unit;
  const amt = args.extraction?.amount_original;
  const isAll = unit === "all";
  const pct = unit === "percent" ? Number(amt) : null;
  if (!isAll && (pct == null || !Number.isFinite(pct) || pct <= 0 || pct > 100)) {
    return {
      valid: false,
      requires_confirmation: false,
      errors: ["missing_sell_amount"],
      warnings,
      normalized_action: null,
      reply_code: "missingAmount",
    };
  }
  if (isAll) requires_confirmation = true;
  if (pct != null && pct > maxSellPct) requires_confirmation = true;
  if (args.profile?.require_confirmation_for_all_tx) requires_confirmation = true;

  return {
    valid: true,
    requires_confirmation,
    errors,
    warnings,
    normalized_action: {
      intent: "sell_token",
      chain: "robinhood",
      input_mint: args.resolvedMint,
      token_address: args.resolvedMint,
      amount_pct: pct,
      amount_all: isAll,
      slippage_bps: slippage,
    },
  };
}

export function validateSolanaSell(args: {
  extraction: any;
  profile: any;
  ownsToken: boolean;
  resolvedMint: string | null;
}): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let requires_confirmation = false;
  const slippage = Number(args.profile?.default_slippage_bps ?? 0);
  const maxSellPct = Number(args.profile?.max_auto_sell_percent ?? 0);
  const resolvedMint = normalizeSolanaAddress(args.resolvedMint);
  if (slippage <= 0)
    return {
      valid: false,
      requires_confirmation: false,
      errors: ["missing_slippage"],
      warnings,
      normalized_action: null,
      reply_code: "missingSlippage",
    };
  if (maxSellPct <= 0)
    return {
      valid: false,
      requires_confirmation: false,
      errors: ["missing_max_sell"],
      warnings,
      normalized_action: null,
      reply_code: "missingMaxSell",
    };
  if (!resolvedMint)
    return {
      valid: false,
      requires_confirmation: false,
      errors: ["missing_token"],
      warnings,
      normalized_action: null,
      reply_code: "missingToken",
    };
  if (!args.ownsToken)
    return {
      valid: false,
      requires_confirmation: false,
      errors: ["no_position"],
      warnings,
      normalized_action: null,
      reply_code: "insufficient",
    };

  const unit = args.extraction?.amount_original_unit;
  const amt = args.extraction?.amount_original;
  const isAll = unit === "all";
  const pct = unit === "percent" ? Number(amt) : null;
  if (!isAll && (pct == null || !Number.isFinite(pct) || pct <= 0 || pct > 100)) {
    return {
      valid: false,
      requires_confirmation: false,
      errors: ["missing_sell_amount"],
      warnings,
      normalized_action: null,
      reply_code: "missingAmount",
    };
  }
  if (isAll) requires_confirmation = true;
  if (pct != null && pct > maxSellPct) requires_confirmation = true;
  if (args.profile?.require_confirmation_for_all_tx) requires_confirmation = true;

  return {
    valid: true,
    requires_confirmation,
    errors,
    warnings,
    normalized_action: {
      intent: "sell_token",
      chain: "solana",
      input_mint: resolvedMint,
      token_address: resolvedMint,
      amount_pct: pct,
      amount_all: isAll,
      slippage_bps: slippage,
    },
  };
}

export function validateTransfer(args: {
  extraction: any;
  amount: { amount_eth: number | null; amount_original_unit: string | null };
  profile: any;
  ethBalance: number;
  recipientInTweetText: boolean;
}): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const recipient: string | null = args.extraction?.recipient ?? null;
  if (!recipient || !isEvmAddress(recipient)) {
    return {
      valid: false,
      requires_confirmation: false,
      errors: ["bad_recipient"],
      warnings,
      normalized_action: null,
      reply_code: "missingToken",
    };
  }
  if (!args.recipientInTweetText) {
    return {
      valid: false,
      requires_confirmation: false,
      errors: ["recipient_not_in_tweet"],
      warnings: ["never auto-pull recipient from parent thread"],
      normalized_action: null,
      reply_code: "missingToken",
    };
  }
  if (args.amount.amount_eth == null)
    return {
      valid: false,
      requires_confirmation: false,
      errors: ["missing_amount"],
      warnings,
      normalized_action: null,
      reply_code: "missingAmount",
    };
  const amountEth = args.amount.amount_eth;
  const maxTransfer = Number(args.profile?.max_auto_transfer_eth ?? 0);
  if (maxTransfer <= 0)
    return {
      valid: false,
      requires_confirmation: false,
      errors: ["transfer_disabled"],
      warnings,
      normalized_action: null,
      reply_code: "transferDisabled",
    };
  if (amountEth > maxTransfer)
    return {
      valid: false,
      requires_confirmation: false,
      errors: ["max_auto_transfer_eth_exceeded"],
      warnings,
      normalized_action: null,
      reply_code: "transferCapExceeded",
    };
  if (amountEth > args.ethBalance)
    return {
      valid: false,
      requires_confirmation: false,
      errors: ["insufficient"],
      warnings,
      normalized_action: null,
      reply_code: "insufficient",
    };

  return {
    valid: true,
    requires_confirmation: true,
    errors,
    warnings,
    normalized_action: {
      intent: "transfer",
      chain: "robinhood",
      recipient,
      amount_eth: amountEth,
      amount_usd: (args.amount as any).amount_usd ?? null,
      amount_original: args.extraction?.amount_original ?? null,
      amount_original_unit: args.extraction?.amount_original_unit ?? null,
      eth_price_usd: (args.amount as any).eth_price_usd ?? null,
    },
  };
}

export function validateSolanaTransfer(args: {
  extraction: any;
  amount: { amount_sol?: number | null; amount_original_unit: string | null };
  profile: any;
  solBalance: number;
  recipientInTweetText: boolean;
}): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const recipient: string | null = normalizeSolanaAddress(args.extraction?.recipient ?? null);
  if (!recipient || !isSolanaAddress(recipient)) {
    return {
      valid: false,
      requires_confirmation: false,
      errors: ["bad_recipient"],
      warnings,
      normalized_action: null,
      reply_code: "missingToken",
    };
  }
  if (!args.recipientInTweetText) {
    return {
      valid: false,
      requires_confirmation: false,
      errors: ["recipient_not_in_tweet"],
      warnings: ["never auto-pull recipient from parent thread"],
      normalized_action: null,
      reply_code: "missingToken",
    };
  }
  const amountSol = args.amount.amount_sol ?? null;
  if (amountSol == null)
    return {
      valid: false,
      requires_confirmation: false,
      errors: ["missing_amount"],
      warnings,
      normalized_action: null,
      reply_code: "missingAmount",
    };
  const maxTransfer = Number(args.profile?.max_auto_transfer_sol ?? 0);
  if (maxTransfer <= 0)
    return {
      valid: false,
      requires_confirmation: false,
      errors: ["transfer_disabled"],
      warnings,
      normalized_action: null,
      reply_code: "transferDisabled",
    };
  if (amountSol > maxTransfer)
    return {
      valid: false,
      requires_confirmation: false,
      errors: ["max_auto_transfer_sol_exceeded"],
      warnings,
      normalized_action: null,
      reply_code: "transferCapExceeded",
    };
  if (amountSol > args.solBalance)
    return {
      valid: false,
      requires_confirmation: false,
      errors: ["insufficient"],
      warnings,
      normalized_action: null,
      reply_code: "insufficient",
    };

  return {
    valid: true,
    requires_confirmation: true,
    errors,
    warnings,
    normalized_action: {
      intent: "transfer",
      chain: "solana",
      recipient,
      amount_sol: amountSol,
      amount_usd: (args.amount as any).amount_usd ?? null,
      amount_original: args.extraction?.amount_original ?? null,
      amount_original_unit: args.extraction?.amount_original_unit ?? null,
      sol_price_usd: (args.amount as any).sol_price_usd ?? null,
    },
  };
}

export function validateLaunch(args: {
  extraction: any;
  hasImage: boolean;
  launchChain?: "robinhood" | "solana" | null;
  devBuy: {
    amount_eth: number | null;
    amount_sol?: number | null;
    amount_usd?: number | null;
    amount_original_unit: string | null;
    eth_price_usd?: number | null;
    sol_price_usd?: number | null;
  };
  profile: any;
  ethBalance?: number;
  solBalance?: number;
}): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!args.hasImage)
    return {
      valid: false,
      requires_confirmation: false,
      errors: ["missing_image"],
      warnings,
      normalized_action: null,
      reply_code: "missingImage",
    };
  const symbol = (args.extraction?.coin_symbol ?? "")
    .toString()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const rawName = String(args.extraction?.coin_name ?? "").trim();
  const name = rawName || symbol;
  if (!symbol)
    return {
      valid: false,
      requires_confirmation: false,
      errors: ["missing_symbol"],
      warnings,
      normalized_action: null,
      reply_code: "missingToken",
    };

  const chain = args.launchChain === "solana" ? "solana" : "robinhood";
  if (chain === "robinhood" && name.length > SINGLE_SIDED_LAUNCH_NAME_MAX_LENGTH) {
    return {
      valid: false,
      requires_confirmation: false,
      errors: ["launch_name_too_long"],
      warnings,
      normalized_action: null,
      reply_code: "launchNameTooLong",
    };
  }
  const devUnit = String(args.devBuy.amount_original_unit ?? "").toLowerCase();
  const metadata = normalizeLaunchMetadataOverrides({
    website: args.extraction?.metadata_website_url,
    twitter: args.extraction?.metadata_twitter_url,
    telegram: args.extraction?.metadata_telegram_url,
  });

  if (chain === "solana") {
    if (
      (devUnit && !["sol", "usd", "eth"].includes(devUnit)) ||
      (devUnit === "eth" && Number(args.extraction?.dev_buy_original ?? 0) > 0)
    ) {
      return {
        valid: false,
        requires_confirmation: false,
        errors: ["unsupported_launch_dev_buy_unit"],
        warnings,
        normalized_action: null,
        reply_code: "missingAmount",
      };
    }

    const dev = Number(args.devBuy.amount_sol ?? 0);
    if (dev > 0) {
      if (dev > Number(args.solBalance ?? 0))
        return {
          valid: false,
          requires_confirmation: false,
          errors: ["insufficient"],
          warnings,
          normalized_action: null,
          reply_code: "insufficient",
        };
    }

    return {
      valid: true,
      requires_confirmation: false,
      errors,
      warnings,
      normalized_action: {
        intent: "launch_coin",
        chain: "solana",
        launch_platform: "pump_fun",
        symbol,
        name,
        description: args.extraction?.coin_description ?? null,
        metadata_website_url: metadata.websiteUrl,
        metadata_twitter_url: metadata.twitterUrl,
        metadata_telegram_url: metadata.telegramUrl,
        dev_buy_sol: dev,
        dev_buy_usd: args.devBuy.amount_usd ?? null,
        dev_buy_original: args.extraction?.dev_buy_original ?? 0,
        dev_buy_original_unit: args.extraction?.dev_buy_original_unit ?? "sol",
        sol_price_usd: (args.devBuy as any).sol_price_usd ?? null,
        creator_rewards_recipient_wallet:
          args.extraction?.creator_rewards_recipient_wallet ?? null,
        creator_rewards_recipient_handle:
          args.extraction?.creator_rewards_recipient_handle ?? null,
        creator_rewards_share_percent:
          args.extraction?.creator_rewards_share_percent ?? null,
        creator_rewards_share_bps:
          args.extraction?.creator_rewards_share_bps ?? null,
      },
    };
  }

  if (
    (devUnit && !["eth", "usd", "sol"].includes(devUnit)) ||
    (devUnit === "sol" && Number(args.extraction?.dev_buy_original ?? 0) > 0)
  ) {
    return {
      valid: false,
      requires_confirmation: false,
      errors: ["unsupported_launch_dev_buy_unit"],
      warnings,
      normalized_action: null,
      reply_code: "missingAmount",
    };
  }

  const dev = args.devBuy.amount_eth ?? 0;
  if (dev > 0) {
    if (dev > Number(args.ethBalance ?? 0))
      return {
        valid: false,
        requires_confirmation: false,
        errors: ["insufficient"],
        warnings,
        normalized_action: null,
        reply_code: "insufficient",
      };
  }
  return {
    valid: true,
    requires_confirmation: false,
    errors,
    warnings,
    normalized_action: {
      intent: "launch_coin",
      chain: "robinhood",
      launch_platform: "robinhood_single_sided_lp",
      symbol,
      name,
      description: args.extraction?.coin_description ?? null,
      metadata_website_url: metadata.websiteUrl,
      metadata_twitter_url: metadata.twitterUrl,
      metadata_telegram_url: metadata.telegramUrl,
      dev_buy_eth: dev,
      dev_buy_usd: args.devBuy.amount_usd ?? null,
      dev_buy_original: args.extraction?.dev_buy_original ?? 0,
      dev_buy_original_unit: args.extraction?.dev_buy_original_unit ?? "eth",
      eth_price_usd: (args.devBuy as any).eth_price_usd ?? null,
      creator_rewards_recipient_handle:
        args.extraction?.creator_rewards_recipient_handle ?? null,
      creator_rewards_share_percent:
        args.extraction?.creator_rewards_recipient_handle ? 100 : null,
      creator_rewards_share_bps:
        args.extraction?.creator_rewards_recipient_handle ? 10_000 : null,
    },
  };
}
