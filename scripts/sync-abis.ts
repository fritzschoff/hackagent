import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const CONTRACTS = [
  "IdentityRegistry",
  "ReputationRegistry",
  "ValidationRegistry",
  "IdentityRegistryV2",
  "AgentINFT",
  "AgentBids",
] as const;

function syncAbi(name: string): void {
  const src = join(
    process.cwd(),
    "contracts",
    "out",
    `${name}.sol`,
    `${name}.json`,
  );
  if (!existsSync(src)) {
    throw new Error(
      `Missing ${src}. Run \`pnpm forge:build\` from the repo root first.`,
    );
  }
  const artifact = JSON.parse(readFileSync(src, "utf8")) as {
    abi: unknown[];
    metadata?: { output?: { devdoc?: { version?: number } } };
  };
  if (!Array.isArray(artifact.abi)) {
    throw new Error(`Artifact ${src} has no ABI array`);
  }
  const dst = join(process.cwd(), "lib", "abis", `${name}.json`);
  writeFileSync(dst, JSON.stringify(artifact.abi, null, 2) + "\n");
  console.log(`abis/${name}.json (${artifact.abi.length} entries)`);
}

function main(): void {
  const abisDir = join(process.cwd(), "lib", "abis");
  if (!existsSync(abisDir)) mkdirSync(abisDir, { recursive: true });
  for (const c of CONTRACTS) syncAbi(c);
}

main();
