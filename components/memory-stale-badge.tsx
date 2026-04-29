/**
 * MemoryStaleBadge — renders nothing if memoryReencrypted is true.
 * Otherwise renders a red-bordered warning explaining the stale state.
 *
 * Can be used as a Server Component (no "use client" needed).
 */
export default function MemoryStaleBadge({
  memoryReencrypted,
}: {
  memoryReencrypted: boolean;
}) {
  if (memoryReencrypted) return null;

  return (
    <div
      className="border border-(--color-amber) rounded-md px-4 py-3 space-y-1"
      role="alert"
    >
      <p className="text-sm font-semibold text-(--color-amber)">
        memory is stale
      </p>
      <p className="text-xs text-(--color-muted) leading-relaxed max-w-2xl">
        This INFT was transferred via a raw <code>transferFrom</code> bypass
        (or a pending oracle proof has not yet been confirmed). The encrypted
        memory blob is still keyed to the previous owner — the new owner cannot
        decrypt it until the oracle re-encrypts it via{" "}
        <code>confirm-transfer</code>. Use the <em>accept bid</em> flow with an
        oracle delegation to trigger automatic re-encryption.
      </p>
    </div>
  );
}
