import Link from "next/link";
import { PRODUCTS } from "@/products";
import { formatUsd, formatUsdCents } from "@/core/money";
import { form990Labor, PRICING, TYPICAL_990 } from "@/products/form-990";
import { LABOR_PLEDGE, pledgeFor } from "@/core/pledge";
import { BOOKS_MONTHLY_PRICE } from "@/products/books";
import { joinWaitlistAction } from "@/app/actions";
import { Button, buttonClass, Card, inputClass, Notice, Shell } from "@/ui/components";
import { currentActor } from "@/ui/session";

const FROM: Record<string, string> = {
  "form-990": `From ${formatUsd(PRICING["990-N"])}. Form 990-EZ ${formatUsd(PRICING["990-EZ"])}. Form 990 ${formatUsd(PRICING["990"])}.`,
  books: `${formatUsd(BOOKS_MONTHLY_PRICE)} per month.`,
};

const EXAMPLE = pledgeFor(form990Labor(TYPICAL_990));
const RATE = `${Math.round(LABOR_PLEDGE.rate * 1000) / 10}%`;

export default async function Home({ searchParams }: { searchParams: Promise<{ joined?: string; error?: string }> }) {
  const actor = await currentActor();
  if (!actor) return <Teaser {...await searchParams} />;
  const start = "/app";
  const hero = (
    <section className="mx-auto max-w-6xl px-4 pb-12 pt-6 sm:pt-10" aria-labelledby="hero">
      <Headline />
      <p className="kicker mt-6 text-sm sm:text-base">Form 990 • Monthly books • Flat prices</p>
      <p className="mt-4 max-w-[60ch] text-[17px] text-on-bg">
        Software prepares your nonprofit&apos;s annual return and monthly books. A licensed professional reviews and signs
        every return. You pay a published flat price, a fraction of what a traditional firm charges.
      </p>
      <div className="mt-7 flex flex-wrap items-center gap-5">
        <Link href={start} className={buttonClass("primary")}>
          Start your return
        </Link>
        <Link href="/labor-pledge" className="nav-link underline!">
          Read the Labor Pledge
        </Link>
      </div>
    </section>
  );

  return (
    <Shell actor={actor} hero={hero}>
      <div className="grid gap-x-6 md:grid-cols-2">
        {PRODUCTS.map((p) => (
          <Card key={p.slug} title={`${p.line}${p.status === "beta" ? " (beta)" : ""}`}>
            <h2 className="text-2xl">{p.name}</h2>
            <p className="mt-2 text-sm">{p.tagline}</p>
            <p className="mt-3 text-sm font-bold">{FROM[p.slug]}</p>
            <p className="mt-1 text-xs text-muted">Signed by: {p.reviewerCredentials.join(", ")}</p>
          </Card>
        ))}
      </div>

      <Card title="The Labor Pledge">
        <p className="max-w-[72ch] text-[15px]">
          When software does work people used to be paid for, the Social Security contributions on that work disappear. We
          put them back. For every engagement we estimate the hours a person would have spent, value them at a living wage
          of {formatUsdCents(LABOR_PLEDGE.hourlyWage)} an hour, and contribute {RATE} to {LABOR_PLEDGE.recipient}. It comes
          out of our fee, not on top of it.
        </p>
        <p className="mt-4 inline-block border-l-4 border-shadow bg-accent-soft px-3 py-2 text-sm font-bold tabular-nums">
          A typical Form 990: {EXAMPLE.hours} hours × {formatUsdCents(EXAMPLE.hourlyWage)} × {RATE} ={" "}
          {formatUsdCents(EXAMPLE.contribution)}
        </p>
        <p className="mt-4 text-sm">
          <Link href="/labor-pledge">How we calculate it</Link>
        </p>
      </Card>

      <Card title="How it works">
        <ol className="list-decimal space-y-2 pl-6 text-sm">
          <li>
            <b>Upload your books.</b> Export a trial balance from QuickBooks, Xero, or Aplos. Accounts are classified to IRS
            lines, totals are tied out, and required schedules are identified.
          </li>
          <li>
            <b>A professional checks and signs.</b> Every return passes automated checks and a line-by-line review by an
            enrolled agent or CPA before it reaches you.
          </li>
          <li>
            <b>Your data stays yours.</b> Each client&apos;s records are encrypted with their own key and walled off at the
            database. Reviewers see only the work assigned to them.
          </li>
        </ol>
      </Card>
    </Shell>
  );
}

const Headline = () => (
  <h1 id="hero" className="display flat text-[clamp(2.2rem,7vw,5.5rem)]">
    Nonprofit and small business chores,
    <br />
    made <span className="pop">easier</span>.
  </h1>
);

/** What the platform will cover. Teaser copy only: no prices or dates until each product ships. */
const COMING: { area: string; items: string[] }[] = [
  { area: "Taxes", items: ["Nonprofit annual returns (Form 990)", "Quarterly estimates", "Business and personal returns"] },
  { area: "Books", items: ["Monthly close and reconciliation", "Board-ready financial statements", "Year-end cleanup"] },
  { area: "Audits", items: ["Audit preparation", "Annual nonprofit audits", "Grant and funder reporting"] },
  { area: "Securities", items: ["Private offering paperwork", "Exempt-offering filings", "Ongoing investor compliance"] },
  { area: "Legal", items: ["Formation and governance documents", "Contracts and policies", "The paperwork you'd otherwise buy a manual for"] },
  { area: "Fundraising", items: ["Campaign feasibility and capacity studies", "Donor research", "Grant applications"] },
];

const PROMISES: [string, string][] = [
  ["Flat prices, published", "You see the price before you start. No hourly billing."],
  ["A professional signs", "Software prepares the work. A licensed professional reviews and signs every deliverable."],
  ["Your data, walled off", "Each client's records are encrypted with their own key and kept separate from everyone else's."],
  ["Workers paid in", "On every job, we pay Social Security contributions on the hours the software saves, toward worker retirement."],
];

/** Public pre-launch page. Everything else requires an invited sign-in. */
function Teaser({ joined, error }: { joined?: string; error?: string }) {
  const hero = (
    <section className="mx-auto max-w-6xl px-4 pb-12 pt-6 sm:pt-10" aria-labelledby="hero">
      <Headline />
      <p className="kicker mt-6 text-sm sm:text-base">Coming soon</p>
      <p className="mt-4 max-w-[58ch] text-[17px] text-on-bg">
        The work you would hire a firm for, at a price that makes sense for a small organization. Taxes, books, audits,
        securities filings, legal paperwork, and fundraising studies: prepared by software, checked and signed by a licensed
        professional, for a flat fee you see up front.
      </p>
      <p className="mt-7">
        <a href="#waitlist" className={buttonClass("primary")}>
          Join the waitlist
        </a>
      </p>
    </section>
  );
  return (
    <Shell hero={hero}>
      <section aria-labelledby="coming">
        <h2 id="coming" className="text-2xl uppercase">What&apos;s coming</h2>
        <p className="mt-1 max-w-[62ch] text-sm text-muted">
          One firm for the back office. We start with nonprofit returns and books, then add each service as it is ready.
        </p>
        <div className="mt-5 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
          {COMING.map((c) => (
            <div key={c.area} className="border-t-4 border-accent pt-3">
              <h3 className="text-lg uppercase tracking-wide">{c.area}</h3>
              <ul className="mt-1 space-y-0.5 text-sm">
                {c.items.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="promises" className="mt-10 border-l-8 border-shadow bg-accent-soft p-5 sm:p-6">
        <h2 id="promises" className="text-2xl uppercase">Every service, the same terms</h2>
        <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {PROMISES.map(([t, d]) => (
            <div key={t}>
              <dt className="font-bold">{t}</dt>
              <dd className="text-sm">{d}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section id="waitlist" className="mx-auto mt-10 max-w-xl scroll-mt-6">
        <Notice error={error} success={joined ? "You're on the list. We'll email you when we open." : undefined} />
        <Card title="Join the waitlist">
          <p className="mb-4 text-sm">Get early access when we open, starting with nonprofits.</p>
          <form action={joinWaitlistAction} className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-sm font-bold">Email</span>
              <input name="email" type="email" required autoComplete="email" className={inputClass} />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-bold">I run a</span>
              <select name="kind" className={inputClass} defaultValue="nonprofit">
                <option value="nonprofit">Nonprofit</option>
                <option value="small_business">Small business</option>
                <option value="other">Something else</option>
              </select>
            </label>
            <Button type="submit">Join the waitlist</Button>
          </form>
        </Card>
        <p className="text-sm">
          Have an invitation? <Link href="/login">Sign in</Link>
        </p>
      </section>
    </Shell>
  );
}
