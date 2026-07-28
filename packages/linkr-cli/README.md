# Linkr CLI

`@linkrcash/cli` installs the `linkr` command, a terminal client for chatting with Linkr from your own computer. It gives users the private `/app/terminal` experience from a local shell: sign in with X, ask account or market questions, continue conversations, attach images, and confirm supported Linkr actions without opening the web terminal.

The CLI talks to the production Linkr API at `https://www.linkr.cash` by default.

## Requirements

- Node.js 20 or newer
- A Linkr account connected with X
- A terminal that can run globally installed npm packages

## Install

```sh
npm install -g @linkrcash/cli
```

After installation, the global command is:

```sh
linkr --help
```

## Quick Start

```sh
linkr login
linkr chat
```

For a one-off prompt:

```sh
linkr chat "show my portfolio"
```

Running `linkr` with no command also starts an interactive chat.

## Login

`linkr login` starts a browser-based authorization flow:

1. The CLI asks Linkr for a temporary device login.
2. Your browser opens a Linkr authorization page.
3. You sign in with X if needed.
4. The browser page shows a short one-time authorization code.
5. You paste that code into the CLI.
6. The CLI stores a scoped, revocable Linkr CLI credential locally.

The browser never displays the API key, and the CLI does not store Supabase refresh tokens.

```sh
linkr login
```

Useful login options:

```sh
linkr login --no-browser
linkr login --read-only
linkr login --full
linkr login --api-url https://www.linkr.cash
```

`--no-browser` prints the login URL without trying to open it automatically.

`--read-only` requests the default chat and read scopes. This is the normal mode for asking questions, viewing account data, researching tokens, and chatting.

`--full` requests additional write scopes for supported value-moving actions. Linkr still enforces server-side scopes, wallet checks, spending caps, confirmations, idempotency, and action expiry. The current CLI full-mode caps are conservative: max buy `0.01 ETH` or `0.05 SOL`, max sell `25%`, max launch initial buy `0.01 ETH` or `0.05 SOL`, max liquidity `0.01 ETH`, max transfers `0`, `500` daily requests, and `25` daily transactions.

You can also override the default API URL with:

```sh
LINKR_API_URL=https://www.linkr.cash linkr login
```

## Commands

| Command | What it does |
| --- | --- |
| `linkr` | Start an interactive chat. |
| `linkr login` | Authorize this computer with Linkr. |
| `linkr logout` | Remove the local CLI credential file. |
| `linkr whoami` | Show the active CLI credential, wallet, and scopes. |
| `linkr chat` | Start an interactive chat. |
| `linkr chat "message"` | Send one prompt and print Linkr's response. |
| `linkr chat -c <id>` | Continue an existing conversation. |
| `linkr chat --image <path>` | Attach a local image file to the prompt. |
| `linkr chat --image-url <url>` | Attach a trusted image URL to the prompt. |
| `linkr conversations` | List Linkr CLI/web terminal conversations. |
| `linkr continue <conversation_id>` | Continue a conversation interactively. |
| `linkr revoke-current` | Revoke the current CLI key on the server and remove local credentials. |

## Chat Examples

Account and portfolio:

```sh
linkr chat "What do I hold on Solana?"
linkr chat "Show my wallet addresses"
linkr chat "What are my recent buys and sells?"
linkr chat "Do I have any pending actions?"
```

Token research and market context:

```sh
linkr chat "Check this token: <full contract address or Solana mint>"
linkr chat "What is the market cap, liquidity, and volume for <mint>"
linkr chat "What are people on X saying about $CASHCAT?"
linkr chat "Compare the last 24h buyers and sellers for <token>"
```

Trading and wallet actions:

```sh
linkr chat "Buy 0.05 SOL of <full Solana mint>"
linkr chat "Buy 0.01 ETH of <full Robinhood Chain contract>"
linkr chat "Sell 25% of <full token address or mint>"
linkr chat "Swap 0.25 SOL for USDC"
linkr chat "Send 0.1 SOL to <recipient address>"
```

Launches, liquidity, rewards, and burns:

```sh
linkr chat "Prepare a Solana launch for a coin called Moon ticker MOON"
linkr chat --image ./logo.png "Launch a Robinhood Chain coin called Linkr Cat ticker LCAT with this image"
linkr chat "Show my active LP positions"
linkr chat "Claim my creator rewards"
linkr chat "Burn 100 tokens on Solana, mint <full Solana mint>"
```

Scheduling:

```sh
linkr chat "Buy 0.05 ETH of <contract address> in 2 hours"
linkr chat "Sell 100% of <Solana mint> if market cap goes above 170k"
linkr chat "Claim my Pump.fun creator rewards every day"
```

Conversation follow-ups:

```sh
linkr chat "Show my recent launches"
linkr chat -c <conversation_id> "Tell me more about the second one"
linkr continue <conversation_id>
```

## What You Can Ask

The CLI uses the same Linkr chat runtime as the private terminal, so you can ask natural-language questions instead of memorizing command syntax.

You can ask about:

- Wallet balances, deposit addresses, portfolio holdings, and token holdings.
- Token research, market data, liquidity, price, volume, market cap, and public X/social context.
- Launch history, transaction history, receipts, pending actions, and recent Linkr activity.
- Supported buys, sells, SOL/USDC swaps, transfers, launches, schedules, liquidity actions, creator rewards, and burns.
- Conversation context such as "this token", "that launch", "the second one", "confirm it", or "cancel that" when the reference is clear.

For executable swaps, use a full Robinhood Chain contract address or a full Solana mint. Cashtags, symbols, and fuzzy names are useful for research, but they are not safe execution inputs for arbitrary buys or sells.

## Action Confirmations

Value-moving actions do not bypass Linkr safeguards just because they start from the terminal.

When an action needs confirmation, the CLI prints the pending action summary and an exact confirmation phrase. You must type the phrase exactly before Linkr submits the action. Leaving the confirmation blank cancels the pending action.

Linkr still checks:

- The credential scopes granted during login.
- Wallet ownership, balances, slippage, chain support, and user limits.
- Required full token addresses or mints for executable actions.
- Confirmation expiry.
- Duplicate submission protection through signed requests and idempotency keys.

Irreversible token burns are deliberately strict. They require an explicit chain, one full contract address or mint in the current command, and an exact amount or `all`.

## Images

Attach up to four images to a chat turn.

Local image files:

```sh
linkr chat --image ./token-logo.png "Use this image for a Solana launch called Cash Cat ticker CASH"
```

Trusted image URLs:

```sh
linkr chat --image-url https://example.com/logo.png "Use this image for the launch"
```

Local uploads currently support PNG, JPG, GIF, and WEBP files from `1 byte` to `4MB`.

## Conversations

List existing CLI/web terminal conversations:

```sh
linkr conversations
```

Continue one by ID:

```sh
linkr continue <conversation_id>
```

Or send a one-off message into a conversation:

```sh
linkr chat -c <conversation_id> "continue from where we left off"
```

## Credentials

Local credentials are stored at:

```txt
~/.linkr/credentials.json
```

On macOS and Linux, the CLI writes this file with private file permissions and refuses to read it if it is world-readable.

Use `logout` to remove only the local file:

```sh
linkr logout
```

Use `revoke-current` to revoke the active server-side CLI key and remove the local file:

```sh
linkr revoke-current
```

You can also revoke CLI-created keys from the Linkr app API keys page.

## Troubleshooting

`Not logged in. Run linkr login first.`

Run:

```sh
linkr login
```

`Expired code`

Run `linkr login` again. Authorization codes are one-time and short-lived.

`Missing scope`

The current CLI key was not authorized for that action. Revoke it and log in again with the needed mode, for example:

```sh
linkr revoke-current
linkr login --full
```

`Browser did not open`

Run:

```sh
linkr login --no-browser
```

Then copy the printed URL into your browser manually.

`Stale clock` or signed request errors

Fix your computer clock and try again. Signed CLI requests depend on a reasonable local timestamp.

`Image must be between 1 byte and 4MB`

Resize or compress the image before attaching it.

`Only PNG, JPG, GIF, and WEBP images are supported`

Convert the image to one of the supported formats.

## Development

From this package directory:

```sh
npm install
npm run build
npm test
npm pack --dry-run
```

Before publishing, inspect the dry-run package contents and make sure only `dist`, `README.md`, `LICENSE`, and package metadata are included.

## License

MIT
