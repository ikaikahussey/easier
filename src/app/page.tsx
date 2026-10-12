import Link from "next/link";
import { PRODUCTS } from "@/products";
import { formatUsd, formatUsdCents } from "@/core/money";
import { form990Labor, PRICING, TYPICAL_990 } from "@/products/form-990";
import { LABOR_PLEDGE, pledgeFor } from "@/core/pledge";
import { BOOKS_MONTHLY_PRICE } from "@/products/books";
import { buttonClass, Card, Shell, Window } from "@/ui/components";
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
  return (
    <Shell actor={actor}>
      {/* The setup wizard: the most familiar way anyone in 1997 was walked through a hard task. */}
      <section className="raised mb-6 p-[3px]" aria-labelledby="welcome">
        <div className="titlebar">
          <span>easier.company Setup</span>
        </div>
        <div className="grid sm:grid-cols-[190px_1fr]">
          <div className="wizard-art flex items-end p-4 sm:min-h-[300px]">
            <p className="font-serif text-4xl font-bold italic leading-none text-white [text-shadow:2px_2px_0_#000]">
              easier
              <span className="block text-base not-italic font-normal tracking-wide">.company</span>
            </p>
          </div>
          <div className="flex flex-col p-5 sm:p-7">
            <h1 id="welcome" className="text-3xl font-bold leading-tight sm:text-4xl">
              Welcome to easier.company
            </h1>
            <div className="mt-4 max-w-[60ch] space-y-3 text-[15px] leading-relaxed">
              <p>This wizard prepares your nonprofit&apos;s annual return and monthly books.</p>
              <p>
                Software does the preparation. A licensed professional reviews and signs every return. You pay a published
                flat price, a fraction of what a traditional firm charges.
              </p>
              <p>To continue, click Next.</p>
            </div>
            <div className="mt-auto pt-5">
              <hr className="etched mb-3" />
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Link href="/labor-pledge" className={buttonClass("quiet")}>
                Labor Pledge
              </Link>
              <Link href={start} className={buttonClass("primary")}>
                Next &gt;
              </Link>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-x-5 md:grid-cols-2">
        {PRODUCTS.map((p) => (
          <Card key={p.slug} title={`${p.line}${p.status === "beta" ? " (beta)" : ""}`}>
            <h2 className="text-2xl font-bold">{p.name}</h2>
            <p className="mt-2 text-sm">{p.tagline}</p>
            <p className="mt-3 text-sm font-bold">{FROM[p.slug]}</p>
            <p className="mt-1 text-xs text-muted">Signed by: {p.reviewerCredentials.join(", ")}</p>
          </Card>
        ))}
      </div>

      <Window title="LABOR.TXT - Notepad" className="mb-6">
        <div className="sunken bg-white p-4 font-mono text-[14px] leading-relaxed">
          <p className="font-bold">THE LABOR PLEDGE</p>
          <p className="mt-3 max-w-[72ch]">
            When software does work people used to be paid for, the Social Security contributions on that work disappear.
            We put them back. For every engagement we estimate the hours a person would have spent, value them at a
            living wage of {formatUsdCents(LABOR_PLEDGE.hourlyWage)} an hour, and contribute {RATE} to{" "}
            {LABOR_PLEDGE.recipient}. It comes out of our fee, not on top of it.
          </p>
          <p className="mt-3">
            A typical Form 990: {EXAMPLE.hours} hours × {formatUsdCents(EXAMPLE.hourlyWage)} × {RATE} ={" "}
            {formatUsdCents(EXAMPLE.contribution)}
          </p>
          <p className="mt-3">
            <Link href="/labor-pledge">How we calculate it</Link>
          </p>
        </div>
      </Window>

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
