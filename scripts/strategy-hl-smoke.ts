/** Smoke test for treasury-strategy-hl.decide. Mirrors strategy-smoke.ts. */
import { decide } from "../lib/treasury-strategy-hl";
import type { HlTreasuryView } from "../lib/hyperliquid-treasury";

const ZERO_PID =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;
const OPEN_PID =
  "0xabababababababababababababababababababababababababababababababab" as `0x${string}`;

const baseTreasury: HlTreasuryView = {
  address: "0x0" as `0x${string}`,
  agent: "0x0" as `0x${string}`,
  owner: "0x0" as `0x${string}`,
  asset: 4,
  usdcBalance: 1_000_000_000n,
  positionId: ZERO_PID,
  positionOpenedAt: 0n,
  lastHeartbeat: 0n,
  heartbeatTimeout: 21600n,
  heartbeatStale: false,
  killed: false,
  oraclePx: 228_000_000n,
  markPx: 228_000_000n,
  hlPosition: {
    szi: 0n,
    entryNtl: 0n,
    isolatedRawUsd: 0n,
    leverage: 0,
    isIsolated: false,
  },
  marginSummary: {
    accountValue: 0n,
    marginUsed: 0n,
    ntlPos: 0n,
    rawUsd: 0n,
  },
};

const cases: [HlTreasuryView, number | null, string][] = [
  [{ ...baseTreasury, killed: true }, 1e-4, "skip:killed"],
  [{ ...baseTreasury, heartbeatStale: true }, 1e-4, "skip:stale"],
  [baseTreasury, null, "skip:no-funding"],
  [{ ...baseTreasury, markPx: 0n }, 1e-4, "skip:no-mark"],
  [baseTreasury, 1e-4, "open:short (longs paying shorts)"],
  [baseTreasury, -1e-4, "open:long (shorts paying longs)"],
  [baseTreasury, 1e-6, "hold:below-open"],
  [
    {
      ...baseTreasury,
      positionId: OPEN_PID,
      hlPosition: { ...baseTreasury.hlPosition, szi: -100n },
    },
    1e-4,
    "hold:short-aligned",
  ],
  [
    {
      ...baseTreasury,
      positionId: OPEN_PID,
      hlPosition: { ...baseTreasury.hlPosition, szi: -100n },
    },
    -1e-4,
    "close:flipped",
  ],
  [
    {
      ...baseTreasury,
      positionId: OPEN_PID,
      hlPosition: { ...baseTreasury.hlPosition, szi: -100n },
    },
    1e-6,
    "close:below-close-threshold",
  ],
  [
    {
      ...baseTreasury,
      positionId: OPEN_PID,
      hlPosition: { ...baseTreasury.hlPosition, szi: 0n },
    },
    1e-4,
    "skip:state-divergence",
  ],
];

for (const [treasury, fundingHourly, label] of cases) {
  const a = decide({ treasury, fundingHourly });
  const side =
    a.kind === "open" ? a.side : a.kind === "close" ? "(close)" : "";
  console.log(
    `${label.padEnd(34)} → ${a.kind.padEnd(6)} ${side.padEnd(8)} · ${a.reason}`,
  );
}
