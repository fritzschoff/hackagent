# Checkpoint 1 — Vercel Pro setup

Estimated time: ~10 minutes.

You only need to run this once. After it's green, you can re-run any of the
substeps independently if you ever rotate creds or move the project.

## 0. Prerequisites

- Vercel account with **Pro** subscription.
- GitHub account (project will be pushed to a new repo).
- Vercel CLI installed locally:
  ```bash
  pnpm add -g vercel
  vercel --version    # should be >= 39
  ```

## 1. Log in & link the project

```bash
vercel login
cd /Users/maxfritz/code/hack-agent
vercel link
```

Pick:

- Scope: your personal account or team (whichever holds the Pro subscription).
- Project name: `hack-agent` (or `tradewise`, your call — keep it short).
- Directory: `.`
- Override settings: **No**.

This creates `.vercel/project.json` (already in `.gitignore`).

## 2. Push to GitHub & connect

```bash
git add .
git commit -m "feat: bootstrap Phase 1 (x402 paying flow on Base Sepolia)"

gh repo create hack-agent --private --source=. --remote=origin
git push -u origin main
```

Then in the Vercel dashboard:

- Project → **Settings** → **Git**
- Click **Connect** → choose the `hack-agent` GitHub repo.

From now on, `git push` to `main` triggers a **production** deploy and any other
branch produces a **preview** deploy. Cron jobs **only fire on production**, so
preview deploys are safe to spam.

## 3. Marketplace: Upstash Redis

Vercel Dashboard → your project → **Storage** → **Create database** →
**Upstash for Redis**.

- Region: pick the same region you chose at the project level (default `iad1`).
- Plan: **Free** is plenty for the demo (10k commands/day).
- Click **Create**.

Vercel auto-injects these env vars into Production + Preview + Development:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

Verify under **Project → Settings → Environment Variables**.

## 4. Marketplace: Edge Config

Vercel Dashboard → your project → **Storage** → **Create database** →
**Edge Config**.

- Name: `agent-config`
- Plan: **Free** (50KB / 1k reads per second is far more than we need).

Vercel auto-injects:

- `EDGE_CONFIG`

Edge Config will hold the deployed contract addresses (P2) and the KeeperHub
workflow id (P4). For now `lib/edge-config.ts` falls back to the zero address
when the config is empty, so it doesn't block P1.

## 5. Cron auth secret

```bash
# generate a random 32-byte secret
SECRET=$(openssl rand -hex 32)
echo "$SECRET"

# push it to all three environments
printf '%s' "$SECRET" | vercel env add CRON_SECRET production
printf '%s' "$SECRET" | vercel env add CRON_SECRET preview
printf '%s' "$SECRET" | vercel env add CRON_SECRET development
```

This secret protects all `/api/cron/*` routes. Vercel automatically injects it
as the `Authorization: Bearer <secret>` header when invoking your crons in
production.

## 6. App URL (used by agent-card and the cron client)

```bash
# get the prod URL from `vercel inspect` after first deploy, or just paste it manually:
# example: https://hack-agent-tradewise.vercel.app

vercel env add NEXT_PUBLIC_APP_URL production
# paste your URL when prompted
```

## 7. First deploy

```bash
vercel deploy --prod
```

This will build with no AGENT_PK / CLIENT*_PK yet — that's fine. The dashboard
should render with **0 jobs** and the agent card endpoint should return a
mostly-empty card with the agent EOA as the zero address. That's expected
until Checkpoint 2.

## 8. Pull env back locally

```bash
vercel env pull .env.local
```

Now your `pnpm dev` will use the same Upstash + Edge Config as production.

## ✅ Done if

1. `https://<your-project>.vercel.app` returns the dashboard with no errors.
2. `https://<your-project>.vercel.app/.well-known/agent-card.json` returns JSON.
3. `vercel env ls production` shows: `UPSTASH_REDIS_REST_URL`,
   `UPSTASH_REDIS_REST_TOKEN`, `EDGE_CONFIG`, `CRON_SECRET`,
   `NEXT_PUBLIC_APP_URL`.

When you confirm step 1 + 2, paste the production URL back and we move to
Checkpoint 2.
