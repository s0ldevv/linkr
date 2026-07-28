import { lintPublicReply, sanitizePublicReply } from "./reply_lint.ts";
import type { LinkrReplyPlan, LinkrTurnOutcome } from "./linkr_types.ts";

export function composeReplyPlanText(plan: LinkrReplyPlan): {
  text: string;
  lint: ReturnType<typeof lintPublicReply>;
  used_fallback: boolean;
} {
  const candidate = sanitizePublicReply(plan.text ?? plan.fallback_text);
  const lint = lintPublicReply(candidate, plan.intent);
  if (candidate && lint.ok) {
    return { text: candidate, lint, used_fallback: false };
  }
  const fallback = sanitizePublicReply(plan.fallback_text);
  return {
    text: fallback,
    lint: lintPublicReply(fallback, plan.intent),
    used_fallback: true,
  };
}

export function outcomeWithReply(plan: LinkrReplyPlan, route: string): LinkrTurnOutcome {
  return {
    status: plan.mode === "confirmation" ? "awaiting_confirmation" : "completed",
    route,
    reply_plan: plan,
  };
}
