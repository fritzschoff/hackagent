import { getRecentJobs, getEarningsCents } from "@/lib/upstash";
import { getCronStatuses } from "@/lib/cron-auth";

export const revalidate = 30;

export default async function DashboardPage() {
  const [jobs, earningsCents, crons] = await Promise.all([
    getRecentJobs(50),
    getEarningsCents(),
    getCronStatuses(),
  ]);

  return (
    <main className="mx-auto max-w-5xl p-8 space-y-12">
      <header className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight">
          tradewise<span className="text-(--color-muted)">.agentlab.eth</span>
        </h1>
        <p className="text-(--color-muted) text-sm">
          autonomous on-chain agent · 1 USDC / quote · base sepolia
        </p>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Stat label="lifetime earnings" value={`${(earningsCents / 100).toFixed(2)} USDC`} accent />
        <Stat label="quotes served" value={String(jobs.length)} />
        <Stat label="status" value="bootstrapping" />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold uppercase tracking-widest text-(--color-muted)">
          cron heartbeat
        </h2>
        <div className="border border-(--color-border) rounded-lg overflow-hidden">
          {crons.length === 0 ? (
            <p className="p-4 text-sm text-(--color-muted)">
              no cron ticks recorded yet — deploy with{" "}
              <code className="text-(--color-accent)">vercel deploy --prod</code>{" "}
              to activate the scheduler
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-(--color-card)">
                <tr>
                  <th className="text-left p-3 font-medium">route</th>
                  <th className="text-left p-3 font-medium">last tick</th>
                  <th className="text-left p-3 font-medium">status</th>
                </tr>
              </thead>
              <tbody>
                {crons.map((c) => (
                  <tr
                    key={c.route}
                    className="border-t border-(--color-border)"
                  >
                    <td className="p-3 font-mono">{c.route}</td>
                    <td className="p-3 text-(--color-muted)">
                      {c.lastTickAgoSec === null
                        ? "never"
                        : `${c.lastTickAgoSec}s ago`}
                    </td>
                    <td className="p-3">
                      <span
                        className={
                          c.lastStatus === "ok"
                            ? "text-(--color-accent)"
                            : "text-(--color-muted)"
                        }
                      >
                        {c.lastStatus ?? "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold uppercase tracking-widest text-(--color-muted)">
          recent jobs
        </h2>
        <div className="border border-(--color-border) rounded-lg overflow-hidden">
          {jobs.length === 0 ? (
            <p className="p-4 text-sm text-(--color-muted)">
              no paid jobs yet — once cron is live, simulated clients will
              start posting swap intents every 2-5 minutes
            </p>
          ) : (
            <ul className="divide-y divide-(--color-border)">
              {jobs.map((j) => (
                <li key={j.id} className="p-3 flex justify-between text-sm">
                  <span className="font-mono truncate">
                    {j.intent.tokenIn.slice(0, 6)}…{" "}
                    →{" "}
                    {j.intent.tokenOut.slice(0, 6)}…
                  </span>
                  <span className="text-(--color-accent)">
                    +1 USDC
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <footer className="text-xs text-(--color-muted) pt-8 border-t border-(--color-border)">
        agent-card →{" "}
        <a
          href="/.well-known/agent-card.json"
          className="text-(--color-accent) underline"
        >
          /.well-known/agent-card.json
        </a>
      </footer>
    </main>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="border border-(--color-border) rounded-lg p-5 bg-(--color-card)">
      <div className="text-xs uppercase tracking-widest text-(--color-muted)">
        {label}
      </div>
      <div
        className={`mt-2 text-3xl font-bold ${
          accent ? "text-(--color-accent)" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}
