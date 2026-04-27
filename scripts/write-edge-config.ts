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
  pricewatchEOA?: `0x${string}`;
  pricewatchAgentId?: number;
  identityRegistryV2?: `0x${string}`;
  inftAddress?: `0x${string}`;
  inftAgentId?: number;
  inftTokenId?: number;
  agentBidsAddress?: `0x${string}`;
  sepoliaUsdcAddress?: `0x${string}`;
  reputationCreditAddress?: `0x${string}`;
  slaBondAddress?: `0x${string}`;
  agentMergerAddress?: `0x${string}`;
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

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const a of process.argv.slice(3)) {
    if (a.startsWith(prefix)) return a.slice(prefix.length);
  }
  return undefined;
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
  const pricewatchEOA = parseArg("pricewatch-eoa") ??
    process.env.PRICEWATCH_EOA;
  const pricewatchAgentIdRaw = parseArg("pricewatch-agentid") ??
    process.env.PRICEWATCH_AGENT_ID;
  if (pricewatchEOA) {
    if (!/^0x[a-fA-F0-9]{40}$/.test(pricewatchEOA)) {
      throw new Error(`Invalid pricewatch EOA: ${pricewatchEOA}`);
    }
    value.pricewatchEOA = pricewatchEOA as `0x${string}`;
  }
  if (pricewatchAgentIdRaw) {
    const n = Number(pricewatchAgentIdRaw);
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`Invalid pricewatch agentId: ${pricewatchAgentIdRaw}`);
    }
    value.pricewatchAgentId = n;
  }

  // Phase 3 (INFT V2). When an inft deployment file exists, layer it in.
  const inftDeployPath = join(
    process.cwd(),
    "contracts",
    "deployments",
    `${network}-inft.json`,
  );
  if (existsSync(inftDeployPath)) {
    const inftDep = JSON.parse(readFileSync(inftDeployPath, "utf8")) as {
      identityRegistryV2: `0x${string}`;
      agentInft: `0x${string}`;
      agentId: number;
    };
    value.identityRegistryV2 = inftDep.identityRegistryV2;
    value.inftAddress = inftDep.agentInft;
    value.inftAgentId = inftDep.agentId;
  }
  const inftTokenIdRaw = parseArg("inft-tokenid") ?? process.env.INFT_TOKEN_ID;
  if (inftTokenIdRaw) {
    const n = Number(inftTokenIdRaw);
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`Invalid INFT tokenId: ${inftTokenIdRaw}`);
    }
    value.inftTokenId = n;
  }

  // Phase 4 (bidding pool).
  const bidsDeployPath = join(
    process.cwd(),
    "contracts",
    "deployments",
    `${network}-bids.json`,
  );
  if (existsSync(bidsDeployPath)) {
    const bidsDep = JSON.parse(readFileSync(bidsDeployPath, "utf8")) as {
      agentBids: `0x${string}`;
      usdc: `0x${string}`;
    };
    value.agentBidsAddress = bidsDep.agentBids;
    value.sepoliaUsdcAddress = bidsDep.usdc;
  }

  // Phase 10 (reputation credit pool).
  const creditDeployPath = join(
    process.cwd(),
    "contracts",
    "deployments",
    `${network}-credit.json`,
  );
  if (existsSync(creditDeployPath)) {
    const creditDep = JSON.parse(readFileSync(creditDeployPath, "utf8")) as {
      reputationCredit: `0x${string}`;
    };
    value.reputationCreditAddress = creditDep.reputationCredit;
  }

  // Phase 11 (SLA bond contract).
  const slaDeployPath = join(
    process.cwd(),
    "contracts",
    "deployments",
    `${network}-sla.json`,
  );
  if (existsSync(slaDeployPath)) {
    const slaDep = JSON.parse(readFileSync(slaDeployPath, "utf8")) as {
      slaBond: `0x${string}`;
    };
    value.slaBondAddress = slaDep.slaBond;
  }

  // Phase 12 (agent merger).
  const mergerDeployPath = join(
    process.cwd(),
    "contracts",
    "deployments",
    `${network}-merger.json`,
  );
  if (existsSync(mergerDeployPath)) {
    const mergerDep = JSON.parse(readFileSync(mergerDeployPath, "utf8")) as {
      agentMerger: `0x${string}`;
    };
    value.agentMergerAddress = mergerDep.agentMerger;
  }
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
