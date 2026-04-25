import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const ROLES = ["agent", "client1", "client2", "client3", "validator"] as const;
type Role = (typeof ROLES)[number];

function generateRole(role: Role) {
  const pk = generatePrivateKey();
  const account = privateKeyToAccount(pk);
  return { role, pk, address: account.address };
}

function envVarName(role: Role): string {
  return role === "agent" ? "AGENT_PK" : `${role.toUpperCase()}_PK`;
}

const wallets = ROLES.map(generateRole);

const lines: string[] = [];
lines.push("");
lines.push("== Generated wallets (paste into Vercel env, never commit) ==");
lines.push("");
for (const w of wallets) {
  lines.push(`${w.role.padEnd(10)}  address: ${w.address}`);
  lines.push(`${" ".repeat(10)}  pk:      ${w.pk}`);
  lines.push(`${" ".repeat(10)}  env:     ${envVarName(w.role)}=${w.pk}`);
  lines.push("");
}

lines.push("== Faucet checklist ==");
lines.push("");
lines.push("Sepolia ETH (gas for ENS + ERC-8004 deploys + writes):");
for (const w of wallets) {
  lines.push(`  ${w.role.padEnd(10)} ${w.address}  https://sepoliafaucet.com/`);
}
lines.push("");
lines.push("Base Sepolia ETH (gas for x402 settlements):");
for (const w of wallets.filter((w) => w.role.startsWith("client"))) {
  lines.push(`  ${w.role.padEnd(10)} ${w.address}  https://www.alchemy.com/faucets/base-sepolia`);
}
lines.push("");
lines.push("Base Sepolia USDC (the actual payment token):");
for (const w of wallets.filter((w) => w.role.startsWith("client"))) {
  lines.push(`  ${w.role.padEnd(10)} ${w.address}  https://faucet.circle.com/`);
}
lines.push("");
lines.push("0G Galileo (for 0G Storage + Compute in P3):");
lines.push(`  agent      ${wallets[0]?.address}  https://faucet.0g.ai/`);
lines.push("");
lines.push("== Vercel env push ==");
lines.push("");
lines.push("Run from repo root:");
lines.push("");
for (const w of wallets) {
  lines.push(
    `  printf '%s' '${w.pk}' | vercel env add ${envVarName(w.role)} production preview development`,
  );
}
lines.push("");
lines.push("Then: vercel env pull .env.local");
lines.push("");

console.log(lines.join("\n"));
