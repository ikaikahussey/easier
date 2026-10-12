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

/** Public pre-launch page. Everything else requires an invited sign-in. */
function Teaser({ joined, error }: { joined?: string; error?: string }) {
  const hero = (
    <section className="mx-auto max-w-6xl px-4 pb-12 pt-6 sm:pt-10" aria-labelledby="hero">
      <Headline />
      <p className="kicker mt-6 text-sm sm:text-base">Coming soon</p>
      <p className="mt-4 max-w-[56ch] text-[17px] text-on-bg">
        Software does the work. A licensed professional checks and signs it. You pay a flat price, published up front. And a
        share of every fee goes back to the workers whose hours the software saves.
      </p>
    </section>
  );
  return (
    <Shell hero={hero}>
      <section id="waitlist" className="mx-auto max-w-xl scroll-mt-6">
        <Notice error={error} success={joined ? "You're on the list. We'll email you when we open." : undefined} />
        <Card title="Join the waitlist">
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
