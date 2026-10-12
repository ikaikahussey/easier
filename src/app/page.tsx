import Link from "next/link";
import { PRODUCTS } from "@/products";
import { formatUsd, formatUsdCents } from "@/core/money";
import { form990Labor, PRICING, TYPICAL_990 } from "@/products/form-990";
import { LABOR_PLEDGE, pledgeFor } from "@/core/pledge";
import { BOOKS_MONTHLY_PRICE } from "@/products/books";
import { buttonClass, Card, Shell } from "@/ui/components";
import { currentActor } from "@/ui/session";

const FROM: Record<string, string> = {
  "form-990": `From ${formatUsd(PRICING["990-N"])}. Form 990-EZ ${formatUsd(PRICING["990-EZ"])}. Form 990 ${formatUsd(PRICING["990"])}.`,
  books: `${formatUsd(BOOKS_MONTHLY_PRICE)} per month.`,
};

const EXAMPLE = pledgeFor(form990Labor(TYPICAL_990));
const RATE = `${Math.round(LABOR_PLEDGE.rate * 1000) / 10}%`;

export default async function Home() {
  const actor = await currentActor();
  const start = actor ? "/app" : "/login";
  const hero = (
    <section className="mx-auto max-w-6xl px-4 pb-12 pt-6 sm:pt-10" aria-labelledby="hero">
      <h1 id="hero" className="display flat text-[clamp(2.2rem,7vw,5.5rem)]">
        Nonprofit and small business chores,
        <br />
        made <span className="pop">easier</span>.
      </h1>
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
