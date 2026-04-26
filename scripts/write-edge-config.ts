import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type Deployment = {
  network: string;
  chainId: number;
  identityRegistry: `0x${string}`;
  reputationRegistry: `0x${string}`;
  validationRegistry: `0x${string}`;
  agentId: number;
  agentDomain: string;
  agentWallet: `0x${string}`;
};

type AddressMap = {
  identityRegistry: `0x${string}`;
  reputationRegistry: `0x${string}`;
  validationRegistry: `0x${string}`;
  agentEOA: `0x${string}`;
  agentId: number;
};

function readVercelToken(): string {
  if (process.env.VERCEL_TOKEN) return process.env.VERCEL_TOKEN;
  const authPath = join(
    homedir(),
    "Library",
    "Application Support",
    "com.vercel.cli",
    "auth.json",
  );
  if (existsSync(authPath)) {
    const raw = JSON.parse(readFileSync(authPath, "utf8")) as { token?: string };
    if (raw.token) return raw.token;
  }
  throw new Error(
    "No Vercel token found. Set VERCEL_TOKEN or run `vercel login`.",
  );
}

function readEdgeConfigId(): string {
  const url = process.env.EDGE_CONFIG;
  if (!url) {
    throw new Error("EDGE_CONFIG env not set. Run `vercel env pull .env.local`.");
  }
  const m = url.match(/edge-config\.vercel\.com\/(ecfg_[A-Za-z0-9]+)/);
  if (!m || !m[1]) throw new Error(`Could not parse Edge Config id from EDGE_CONFIG=${url}`);
  return m[1];
}

function readDeployment(network: string): Deployment {
  const path = join(process.cwd(), "contracts", "deployments", `${network}.json`);
  if (!existsSync(path)) {
    throw new Error(
      `Missing ${path}. Run \`pnpm forge:deploy:${network}\` first.`,
    );
  }
  return JSON.parse(readFileSync(path, "utf8")) as Deployment;
}

async function upsertAddresses(
  edgeConfigId: string,
  vercelToken: string,
  teamId: string | undefined,
  key: string,
  value: AddressMap,
): Promise<void> {
  const qs = teamId ? `?teamId=${teamId}` : "";
  const url = `https://api.vercel.com/v1/edge-config/${edgeConfigId}/items${qs}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${vercelToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      items: [{ operation: "upsert", key, value }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Edge Config write failed: ${res.status} ${body}`);
  }
}

async function main(): Promise<void> {
  const network = process.argv[2] ?? "sepolia";
  const dep = readDeployment(network);
  const value: AddressMap = {
    identityRegistry: dep.identityRegistry,
    reputationRegistry: dep.reputationRegistry,
    validationRegistry: dep.validationRegistry,
    agentEOA: dep.agentWallet,
    agentId: dep.agentId,
  };
  const id = readEdgeConfigId();
  const token = readVercelToken();
  const teamId = process.env.VERCEL_TEAM_ID ?? "team_xm9zliWnyGJOsqIMHfNlXkGF";

  await upsertAddresses(id, token, teamId, `addresses_${network}`, value);
  console.log(
    `Edge Config '${id}' updated: addresses_${network} =`,
    JSON.stringify(value, null, 2),
  );
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
