"use client";

type Props = {
  requiredHexId: string;
  requiredName: string;
  visible: boolean;
  onSwitch: () => void;
  busy?: boolean;
};

export default function NetworkBanner({
  requiredName,
  visible,
  onSwitch,
  busy,
}: Props) {
  if (!visible) return null;
  return (
    <div className="net-banner" role="alert">
      <span className="display-italic text-base">!</span>
      <span className="net-banner-text">
        wrong network — switch wallet to{" "}
        <span className="display-italic">{requiredName}</span> to continue
      </span>
      <button
        onClick={onSwitch}
        disabled={busy}
        className="btn"
        type="button"
      >
        switch →
      </button>
    </div>
  );
}
