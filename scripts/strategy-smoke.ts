/** Quick smoke test for the pure decide() function. Not a real test suite. */
import { decide } from "../lib/treasury-strategy";

const baseTreasury = {
  address: "0x0" as `0x${string}`,
  agent: "0x0" as `0x${string}`,
  owner: "0x0" as `0x${string}`,
  usdcBalance: 1_000_000n,
  positionId:
    "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
  positionSize: 0n,
  positionCollateral: 0n,
  lastHeartbeat: 0n,
  heartbeatTimeout: 21600n,
  heartbeatStale: false,
  killed: false,
};
const baseFunding = {
  ratePerSecond: "278",
  exchange: "0x0",
  workflowRunId: "x",
  ts: Date.now(),
};
const cases: [typeof baseTreasury, typeof baseFunding | null, string][] = [
  [{ ...baseTreasury, killed: true }, baseFunding, "skip:killed"],
  [{ ...baseTreasury, heartbeatStale: true }, baseFunding, "skip:stale"],
  [baseTreasury, null, "skip:no-funding"],
  [baseTreasury, baseFunding, "open:short"],
  [baseTreasury, { ...baseFunding, ratePerSecond: "-278" }, "open:long"],
  [baseTreasury, { ...baseFunding, ratePerSecond: "50" }, "hold:below-open"],
  [
    {
      ...baseTreasury,
      positionId: "0xaa" as `0x${string}`,
      positionSize: -1_000_000_000_000_000_000n,
      positionCollateral: 500_000n,
    },
    baseFunding,
    "hold:short-aligned",
  ],
  [
    {
      ...baseTreasury,
      positionId: "0xaa" as `0x${string}`,
      positionSize: -1_000_000_000_000_000_000n,
      positionCollateral: 500_000n,
    },
    { ...baseFunding, ratePerSecond: "-100" },
    "close:flipped",
  ],
  [
    {
      ...baseTreasury,
      positionId: "0xaa" as `0x${string}`,
      positionSize: -1_000_000_000_000_000_000n,
      positionCollateral: 500_000n,
    },
    { ...baseFunding, ratePerSecond: "30" },
    "close:below-close-threshold",
  ],
];
for (const [t, f, label] of cases) {
  const a = decide({ treasury: t, funding: f });
  const side = a.kind === "open" ? a.side : "";
  console.log(
    `${label.padEnd(28)} → ${a.kind.padEnd(6)} ${side.padEnd(6)} · ${a.reason}`,
  );
}
