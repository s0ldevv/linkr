// deno-lint-ignore-file no-explicit-any
export type PlatformMode =
  | "normal"
  | "degraded"
  | "commands_paused"
  | "intake_paused";

export interface WorkAcceptance {
  work_item_id: string;
  request_id: string;
  state: string;
  duplicate: boolean;
  enqueued: boolean;
  message_id?: number | null;
  result_ref?: string | null;
}

export async function readPlatformMode(admin: any): Promise<PlatformMode> {
  const result = await admin.from("linkr_platform_control").select("mode").eq(
    "singleton",
    true,
  ).maybeSingle();
  if (result.error) throw result.error;
  return (result.data?.mode ?? "intake_paused") as PlatformMode;
}

export async function acceptWork(
  admin: any,
  input: Record<string, unknown>,
): Promise<WorkAcceptance> {
  const mode = await readPlatformMode(admin);
  if (mode === "intake_paused") throw new Error("platform_intake_paused");
  if (mode === "commands_paused") throw new Error("platform_commands_paused");
  const result = await admin.rpc("accept_linkr_work_item", input);
  if (result.error) throw result.error;
  return result.data as WorkAcceptance;
}

export function shouldWriteAuthoritativeRateLimit(options: {
  authenticated: boolean;
  mutation: boolean;
  agentApi: boolean;
  expensiveRead: boolean;
}): boolean {
  return options.authenticated || options.mutation || options.agentApi ||
    options.expensiveRead;
}
