import Link from "next/link";

const ITEMS = [
  { href: "/", label: "dashboard", key: "dashboard" },
  { href: "/inft", label: "inft", key: "inft" },
  { href: "/ipo", label: "ipo", key: "ipo" },
  { href: "/credit", label: "credit", key: "credit" },
  { href: "/marketplace", label: "marketplace", key: "marketplace" },
  { href: "/merger", label: "m&a", key: "merger" },
  { href: "/faq", label: "faq", key: "faq" },
] as const;

export default function SiteNav({
  active,
}: {
  active: (typeof ITEMS)[number]["key"];
}) {
  return (
    <nav className="pt-6 pb-3 mb-4 flex items-center justify-between text-xs font-mono">
      <span className="display-italic text-base">
        agentlab<span className="text-(--color-muted)">.eth</span>
      </span>
      <ul className="flex flex-wrap gap-x-5 gap-y-2">
        {ITEMS.map((item) => {
          const current = item.key === active;
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                className={
                  current
                    ? "text-(--color-fg) border-b border-(--color-fg) pb-0.5"
                    : "text-(--color-muted) hover:text-(--color-fg) transition-colors"
                }
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
