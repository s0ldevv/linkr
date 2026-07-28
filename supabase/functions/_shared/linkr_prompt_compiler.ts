import { compileContextSlots } from "./context_slots.ts";
import { personaSystemPrompt } from "./linkr_persona.ts";
import type { LinkrPromptSpec, LinkrWorkingFrame } from "./linkr_types.ts";

export function compileLinkrPromptSpec(args: {
  name: string;
  version: string;
  frame: LinkrWorkingFrame;
  route: string;
  instruction: string;
  source_slots?: Record<string, string>;
  model_tier?: LinkrPromptSpec["model_tier"];
}): LinkrPromptSpec {
  const slots = compileContextSlots(args.frame, args.source_slots ?? {});
  return {
    name: args.name,
    version: args.version,
    model_tier: args.model_tier ?? "mini",
    max_output_chars: args.frame.constraints.max_reply_chars,
    privacy: ["public"],
    input_slots: slots,
    messages: [
      { role: "system", content: personaSystemPrompt(routeRegister(args.route)) },
      {
        role: "user",
        content: [
          args.instruction,
          "",
          "Route: " + args.route,
          "User ask:",
          args.frame.user_ask,
          "",
          "Facts:",
          slots.facts || "(none)",
          "",
          "Entities:",
          slots.entities || "(none)",
        ].join("\n"),
      },
    ],
  };
}

function routeRegister(route: string) {
  if (/transfer|launch|liquidity|confirm/i.test(route)) return "money";
  if (/coin|market|search/i.test(route)) return "market";
  if (/safe|data/i.test(route)) return "support";
  return "small_talk";
}
