"use client";

import { useState } from "react";

type Props = { address: `0x${string}` };

export function CopyAddress({ address }: Props) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(address);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="px-3 py-1.5 text-sm font-medium rounded-md border border-(--color-border) bg-(--color-surface) hover:opacity-90"
    >
      {copied ? "Copied" : "Copy address"}
    </button>
  );
}
