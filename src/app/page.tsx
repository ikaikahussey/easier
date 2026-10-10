import Link from "next/link";
import { PRODUCTS } from "@/products";
import { formatUsd } from "@/core/money";
import { BENCHMARK, PRICING } from "@/products/form-990";
import { LABOR_PLEDGE, pledgeFor } from "@/core/pledge";
import { BOOKS_MONTHLY_PRICE } from "@/products/books";
import { Shell } from "@/ui/components";
import { currentActor } from "@/ui/session";

const FROM: Record<string, string> = {
  "form-990": `From ${formatUsd(PRICING["990-N"])} · Form 990-EZ ${formatUsd(PRICING["990-EZ"])} · Form 990 ${formatUsd(PRICING["990"])}`,
  books: `${formatUsd(BOOKS_MONTHLY_PRICE)} per month`,
};

export default async function Home() {
  const actor = await currentActor();
  return (
    <Shell actor={actor}>
      <section className="max-w-3xl py-10">
        <h1 className="text-4xl font-semibold leading-tight sm:text-5xl">Firm-grade work at plain prices.</h1>
        <p className="mt-5 text-lg text-muted">
          AI prepares the work. A licensed professional reviews and signs it. You pay a published flat price, a fraction of
          what a traditional firm charges.
        </p>
        <div className="mt-8 flex gap-3">
          <Link href={actor ? "/app" : "/login"} className="rounded-md bg-accent px-5 py-2.5 text-white">
            Start your return
          </Link>
        </div>
      </section>

      <section className="grid gap-5 py-6 md:grid-cols-2">
        {PRODUCTS.map((p) => (
          <article key={p.slug} className="rounded-lg border border-line bg-white p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-accent">
              {p.line} {p.status === "beta" && <span className="ml-1 text-muted">· Beta</span>}
            </p>
            <h2 className="mt-2 text-2xl font-semibold">{p.name}</h2>
            <p className="mt-2 text-muted">{p.tagline}</p>
            <p className="mt-4 text-sm">{FROM[p.slug]}</p>
            <p className="mt-1 text-xs text-muted">Signed by: {p.reviewerCredentials.join(", ")}</p>
          </article>
        ))}
      </section>

      <section className="my-6 rounded-lg border border-accent/30 bg-accent-soft p-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-accent">The Labor Pledge</p>
        <h2 className="mt-2 text-3xl font-semibold">When AI does the work, workers still get paid in.</h2>
        <div className="mt-4 grid gap-6 text-sm md:grid-cols-2">
          <p>
            Lower prices come from AI doing work people used to be paid for. On every engagement, we calculate the value of
            that displaced labor (what a traditional firm would have charged, minus our fee) and voluntarily contribute{" "}
            {Math.round(LABOR_PLEDGE.rate * 1000) / 10}%, {LABOR_PLEDGE.rateBasis}, to {LABOR_PLEDGE.recipient}.
          </p>
          <p>
            The contribution comes out of our fee, not on top of it, and every quote shows the amount. On a{" "}
            {formatUsd(PRICING["990"])} Form 990 that would cost about {formatUsd(BENCHMARK["990"])} at a traditional firm,
            we contribute {formatUsd(pledgeFor(BENCHMARK["990"], PRICING["990"]).contribution)}.
          </p>
        </div>
      </section>

      <section className="grid gap-6 border-t border-line py-10 text-sm md:grid-cols-3">
        {[
          ["Prepared from your books", "Upload a trial balance. Accounts are classified to IRS lines, totals are tied out, and schedules are identified automatically."],
          ["Checked, then signed", "Every return passes automated checks and line-by-line review by an enrolled agent or CPA before it reaches you."],
          ["Your data stays yours", "Each client's records are encrypted with their own key and isolated at the database level. Reviewers see only the work assigned to them."],
        ].map(([t, b]) => (
          <div key={t}>
            <h3 className="text-lg font-semibold">{t}</h3>
            <p className="mt-2 text-muted">{b}</p>
          </div>
        ))}
      </section>
    </Shell>
  );
}
