# CLAUDE.md

## Tooling available in this repo

- **Vercel CLI** is installed and the working directory is already linked to the project `fritzschoffs-projects/hackagent`. Use it directly rather than asking the user to run things.
  - `vercel env ls` / `vercel env add` / `vercel env rm` — environment variables for all environments
  - `vercel env pull` — sync to `.env.local`
  - `vercel deploy` / `vercel --prod` — deployments
  - `vercel project ls`, `vercel logs <url>` — diagnostics
- **Foundry** for Solidity (`forge test`, `forge script`), see `contracts/`.
- **gh** is authenticated as `fritzschoff` and points at `fritzschoff/hackagent` on GitHub. Use it for issues / PRs / API calls.
- **cast** for on-chain reads/writes against Base Sepolia (`BASE_SEPOLIA_RPC_URL` in `.env.local`).

## Repo-specific patterns

- Contract addresses live in **Vercel Edge Config**, read via `lib/edge-config.ts`. After redeploying contracts, the Edge Config entries need to be updated — Edge Config writes are *not* covered by `vercel env`; use the Vercel dashboard or the Edge Config REST API. **Don't tell the user to do it manually when it's something the CLI / API can do.**
- ABI sync: after editing contracts, run `pnpm tsx scripts/sync-abis.ts` to copy ABIs into `lib/abis/`.
- Env: secrets live in `.env.local` (gitignored). `set -a && source .env.local && set +a` to load them into a shell session.
- Agent EOA on Base Sepolia: `0x7a83678e330a0C565e6272498FFDF421621820A3`. Funded enough for normal redeploys.

## Behaviors to repeat

- When the user asks for an action that requires keys or infrastructure access, **check whether the tooling is already available before asking the user to do it themselves.** The user has set up CLIs and env files for a reason; making them context-switch back into the shell defeats the purpose.
