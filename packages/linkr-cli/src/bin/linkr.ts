#!/usr/bin/env node
import { Command } from "commander";
import {
  chatCommand,
  continueCommand,
  conversationsCommand,
  doctorCommand,
  loginCommand,
  logoutCommand,
  revokeCurrentCommand,
  whoamiCommand,
} from "../commands.js";
import { formatCliError } from "../errors.js";
import { VERSION } from "../version.js";

const program = new Command();

program.name("linkr").description("Chat with Linkr from your terminal.").version(VERSION);

program
  .command("login")
  .description("Authorize this computer with Linkr.")
  .option("--api-url <url>", "Linkr API URL")
  .option("--full", "Request chat plus value-moving scopes with conservative caps")
  .option("--read-only", "Request read and chat scopes only")
  .option("--no-browser", "Print the auth URL without opening a browser")
  .action((options) => run(() => loginCommand(options)));

program
  .command("logout")
  .description("Remove local Linkr CLI credentials.")
  .option("--revoke", "Revoke the current server-side CLI key before removing credentials")
  .action((options) => run(() => logoutCommand(options)));

program
  .command("doctor")
  .description("Check local Linkr CLI configuration and API reachability.")
  .option("--api-url <url>", "Linkr API URL")
  .action((options) => run(() => doctorCommand(options)));

program
  .command("whoami")
  .description("Show the active Linkr CLI credential.")
  .action(() => run(whoamiCommand));

program
  .command("chat")
  .description("Start an interactive Linkr chat, or send one prompt.")
  .argument("[message]", "Prompt to send")
  .option("-c, --conversation <id>", "Continue a conversation")
  .option("--image <path>", "Attach an image file", collect, [])
  .option("--image-url <url>", "Attach a trusted image URL", collect, [])
  .action((message, options) => run(() => chatCommand(message, options)));

program
  .command("conversations")
  .description("List Linkr CLI/web terminal conversations.")
  .action(() => run(conversationsCommand));

program
  .command("continue")
  .description("Continue a conversation.")
  .argument("<conversation_id>")
  .action((conversationId) => run(() => continueCommand(conversationId)));

program
  .command("revoke-current")
  .description("Revoke this CLI key and remove local credentials.")
  .action(() => run(revokeCurrentCommand));

program.action(() => run(() => chatCommand(undefined, {})));

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

function collect(value: string, previous: string[]) {
  return [...previous, value];
}

async function run(fn: () => Promise<void>) {
  try {
    await fn();
  } catch (error) {
    console.error(formatCliError(error));
    process.exitCode = 1;
  }
}
