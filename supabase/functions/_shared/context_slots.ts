import { capabilityPromptFacts } from "./linkr_capabilities.ts";
import { LINKR_PERSONA_KERNEL } from "./linkr_persona.ts";
import type { LinkrWorkingFrame } from "./linkr_types.ts";

export type LinkrContextSlotName =
  | "kernel"
  | "capabilities"
  | "thread"
  | "conversation"
  | "task"
  | "account"
  | "facts"
  | "entities";

export const DEFAULT_SLOT_BUDGETS: Record<LinkrContextSlotName, number> = {
  kernel: 700,
  capabilities: 900,
  thread: 1400,
  conversation: 1200,
  task: 700,
  account: 700,
  facts: 1400,
  entities: 800,
};

export function compileContextSlots(
  frame: LinkrWorkingFrame,
  source: Record<string, string>,
  budgets: Partial<Record<LinkrContextSlotName, number>> = {},
): Record<string, string> {
  const merged = { ...DEFAULT_SLOT_BUDGETS, ...budgets };
  return {
    kernel: clip(JSON.stringify(LINKR_PERSONA_KERNEL), merged.kernel),
    capabilities: clip(capabilityPromptFacts(), merged.capabilities),
    thread: clip(source.thread ?? "", merged.thread),
    conversation: clip(source.conversation ?? "", merged.conversation),
    task: clip(frame.user_ask, merged.task),
    account: clip(source.account ?? "", merged.account),
    facts: clip(frame.fact_ledger.map((fact) => `${fact.id}: ${fact.summary}`).join("\n"), merged.facts),
    entities: clip(
      frame.entity_ledger.map((entity) => `${entity.id}: ${entity.label}`).join("\n"),
      merged.entities,
    ),
  };
}

export function clip(value: string, maxChars: number): string {
  const text = String(value ?? "").trim();
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(0, maxChars - 3)).trimEnd() + "...";
}
