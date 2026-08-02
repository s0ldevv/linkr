# Robinhood Pons-Style IPFS Metadata Rollout

Date: 2026-08-02

## Goal

Make Linkr Robinhood Chain launches expose metadata in the same practical shape as Pons-launched tokens:

- ERC-20 basics from `name()`, `symbol()`, and `decimals()`.
- Direct on-chain `logo()` getter containing an `ipfs://...` image URI.
- Direct on-chain `description()` getter.
- Direct on-chain `socials()` tuple: `twitter`, `telegram`, `discord`, `website`, `farcaster`.
- Direct on-chain `getTokenInfo()` tuple: deployer, logo, description, socials.
- Full JSON metadata still stored on IPFS and used as `tokenURI`.

## Important Constraint

Token addresses are CREATE2-derived from the `LaunchToken` constructor args. Any on-chain metadata included in those args must be finalized before prediction. Do not put the future token address into constructor metadata fields, because that creates a circular dependency:

`token address -> metadata URL -> constructor args -> token address`

Token-specific app pages can still be stored in the database after prediction. Immutable on-chain `website` metadata must use a stable URL such as `https://linkr.cash` or `https://linkr.cash/coin`, unless the user supplies their own project website.

## Contract Changes

Files:

- `contracts/contracts/LaunchToken.sol`
- `contracts/contracts/LaunchFactory.sol`

Changes:

- Added `LaunchToken.Socials`.
- Added public `logo` and `description` string getters.
- Kept existing `tokenURI` getter for compatibility.
- Added `socials()` and `getTokenInfo()` matching the Pons-compatible metadata shape.
- Added `logo`, `description`, and `socials` to `LaunchFactory.LaunchParams`.
- Required non-empty `logo` at factory validation time.
- Preserved the existing `TokenLaunched` event signature so confirmation workers do not need a new event topic.

## Backend Changes

Files:

- `supabase/functions/_shared/robinhood_launch/abi.ts`
- `supabase/functions/_shared/robinhood_launch/constants.ts`
- `supabase/functions/_shared/robinhood_launch/worker_adapter.ts`
- `supabase/functions/_shared/robinhood_launch/launch.ts`
- `supabase/functions/worker-launch-robinhood/index.ts`
- `supabase/.env.example`

Changes:

- Updated factory ABI tuple to include `logo`, `description`, and nested `socials`.
- Updated launch draft signing code so `predictTokenAddress`, `staticCall`, gas estimate, signed transaction, and broadcast all use the same metadata tuple.
- Updated production fallback addresses to the newly deployed factory and locker.
- Added bounded metadata field lengths for constructor calldata.
- Changed the Robinhood launch worker to prepare assets through the IPFS/Filebase path.
- Enforced `ipfs://` metadata JSON URI and `ipfs://` logo URI before signing.
- Added `IPFS_UPLOAD_ENABLED=true` and `IPFS_UPLOAD_REQUIRED=true` to `supabase/.env.example`.

## New Robinhood Mainnet Contracts

- Network: Robinhood Chain mainnet
- Chain ID: `4663`
- Factory: `0xdf669618137Ae2351D2D68962db0a4F5C28d45FA`
- Locker: `0x4EBA678D131f95Bd3d1340DDFe44441E61f49505`
- Deployer: `0xccFECa2E302aAfaf6439Bb94eE1e87d58ae14789`
- Treasury: `0xAa2fA751fC328634B08141a9D4F89033a33CC2A9`
- Launch fee: `0`
- Factory creation tx: `0x0eedbcffcd30ae6ce2b69439dc1e42f847af8b62d7500222d808345e52aa727f`
- Locker creation tx: `0xde30602535f05ac272a1eecf45688cdc7871e1fa20235337ff503a1012188584`

Blockscout:

- `https://robinhoodchain.blockscout.com/address/0xdf669618137Ae2351D2D68962db0a4F5C28d45FA#code`
- `https://robinhoodchain.blockscout.com/address/0x4EBA678D131f95Bd3d1340DDFe44441E61f49505#code`

## Runtime Rollout

Supabase production project:

- Project ref: `xnxdbcfcxaqukmsajjfm`
- IPFS/Filebase secrets were already present.
- `IPFS_UPLOAD_ENABLED` and `IPFS_UPLOAD_REQUIRED` were already present.
- Adding `ROBINHOOD_LAUNCH_FACTORY_ADDRESS` and `ROBINHOOD_LAUNCH_LOCKER_ADDRESS` as Supabase secrets failed because the project is at the 100-secret maximum.
- To avoid secret-slot churn, the deployed Edge Functions use the updated bundled fallback addresses from `constants.ts`.

Deployed Supabase Edge Functions:

- `worker-launch-robinhood`
- `creator-rewards-earnings`
- `creator-rewards-config`
- `agent-creator-rewards-claim`

Vercel:

- No manual Vercel deployment was run.
- No Vercel contract-address env var is required for this rollout.
- Existing `VITE_IPFS_GATEWAY_URL` remains the only relevant frontend IPFS env.
- Frontend/repo changes should deploy through GitHub only, avoiding a double deploy.

## Verification Completed

Commands run:

- `npm test` in `contracts`
- `deno test --allow-env --allow-read supabase/functions/_shared/robinhood_launch/worker_adapter_test.ts`
- `deno check supabase/functions/worker-launch-robinhood/index.ts`
- `deno check supabase/functions/_shared/robinhood_launch/launch.ts`
- `deno check supabase/functions/creator-rewards-earnings/index.ts`
- `deno check supabase/functions/creator-rewards-config/index.ts`
- `deno check supabase/functions/agent-creator-rewards-claim/index.ts`
- `npm run smoke:robinhood` in `contracts`

Results:

- Contract tests passed.
- Deno tests/checks passed.
- Robinhood smoke checks passed.
- Locker verified on Blockscout.
- Factory verified on Blockscout.

## Follow-Up

- Launch one low-risk Robinhood test token through production and inspect:
  - `tokenURI()`
  - `logo()`
  - `description()`
  - `socials()`
  - `getTokenInfo()`
  - DEX Screener pair discovery after liquidity and first swap activity.
- If Supabase secret slots are cleaned up later, add explicit `ROBINHOOD_LAUNCH_FACTORY_ADDRESS` and `ROBINHOOD_LAUNCH_LOCKER_ADDRESS` secrets as an override, then redeploy the same affected Edge Functions.
