import type { Metadata } from "next";
import Link from "next/link";
import { formatUsdCents } from "@/core/money";
import { LABOR_PLEDGE, pledgeFor, type PledgeTerms } from "@/core/pledge";
import { booksLabor, TYPICAL_BOOKS_ACCOUNTS } from "@/products/books";
import { form990Labor, TYPICAL_990 } from "@/products/form-990";
import { buttonClass, Card, Shell } from "@/ui/components";
import { currentActor } from "@/ui/session";

export const metadata: Metadata = {
  title: "The Labor Pledge — easier.company",
  description: "How easier.company calculates its voluntary contribution toward worker retirement on the labor its AI displaces.",
};

const RATE = `${Math.round(LABOR_PLEDGE.rate * 1000) / 10}%`;

/** Worked examples are computed by the same functions that price every quote. */
const EXAMPLES: { title: string; note: string; pledge: PledgeTerms }[] = [
  {
    title: "Form 990",
    note: `A typical full return: ${TYPICAL_990.accounts} accounts, ${TYPICAL_990.programs} programs, ${TYPICAL_990.officers} officers and directors, Schedules ${TYPICAL_990.schedules.join(", ")}.`,
    pledge: pledgeFor(form990Labor(TYPICAL_990)),
  },
  {
    title: "Form 990-EZ",
    note: "A smaller organization: 35 accounts, 2 programs, 5 officers and directors, Schedules A and B.",
    pledge: pledgeFor(
      form990Labor({ formType: "990-EZ", accounts: 35, expenseLines: 0, programs: 2, officers: 5, schedules: ["A", "B"] }),
    ),
  },
  {
    title: "Form 990-N (e-Postcard)",
    note: "Organizations with gross receipts normally of $50,000 or less.",
    pledge: pledgeFor(form990Labor({ ...TYPICAL_990, formType: "990-N" })),
  },
  {
    title: "Monthly close",
    note: `One month of nonprofit bookkeeping with ${TYPICAL_BOOKS_ACCOUNTS} accounts.`,
    pledge: pledgeFor(booksLabor(TYPICAL_BOOKS_ACCOUNTS)),
  },
];

function Example({ title, note, pledge }: (typeof EXAMPLES)[number]) {
  return (
    <Card title={title}>
      <p className="mb-3 text-sm text-muted">{note}</p>
      <div className="sunken bg-white p-[2px]">
        <table className="listview w-full text-sm">
          <thead>
            <tr className="text-left">
              <th>Task a person would do</th>
              <th className="text-right">Hours</th>
            </tr>
          </thead>
          <tbody>
            {pledge.tasks.map((t) => (
              <tr key={t.label}>
                <td className="pr-4">{t.label}</td>
                <td className="text-right tabular-nums">{t.hours}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-black font-bold">
              <td>Total hours</td>
              <td className="text-right tabular-nums">{pledge.hours}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-3 border border-black bg-accent-soft px-3 py-2 text-sm tabular-nums">
        {pledge.hours} hours × {formatUsdCents(pledge.hourlyWage)} = {formatUsdCents(pledge.laborValue)} of labor ×{" "}
        {RATE} = <strong>{formatUsdCents(pledge.contribution)}</strong> contributed
      </p>
    </Card>
  );
}

export default async function LaborPledgePage() {
  const actor = await currentActor();
  return (
    <Shell actor={actor}>
      <article className="sunken mb-6 bg-white px-5 py-6 font-serif text-[17px] leading-relaxed sm:px-10">
        <div className="max-w-[68ch]">
        <h1 className="text-4xl font-bold leading-tight">The Labor Pledge</h1>
        <p className="mt-1 text-xl italic">When AI does the work, workers still get paid in.</p>
        <hr className="my-4 border-t-2 border-black" />
        <p>
          Our prices are low because AI does work that people used to be paid to do. When that work leaves a payroll, so do
          the Social Security contributions that come with it. The Labor Pledge puts that money back: on every engagement,
          easier.company voluntarily contributes toward worker retirement what payroll tax would have paid on the human labor our
          AI replaced.
        </p>

        <section className="my-6 border-2 border-black bg-accent-soft p-5 text-center">
          <p className="text-2xl font-bold sm:text-3xl">
            Human hours × {formatUsdCents(LABOR_PLEDGE.hourlyWage)} × {RATE} = contribution
          </p>
          <p className="mt-2 font-sans text-sm">Calculated for every engagement and shown on every quote.</p>
        </section>

        <h2 className="mt-8 text-2xl font-bold">How each part is set</h2>
        <div className="mt-3 space-y-5">
          <div>
            <h3 className="text-xl font-bold">1. Human hours</h3>
            <p className="mt-1">
              The platform estimates how long a professional preparer or bookkeeper would have spent on the engagement, task
              by task. Each task has a set time per item, such as 3 minutes to classify each ledger account or 45 minutes to
              write each program description, so the estimate grows with the actual size of the job. Before your books are
              uploaded, the quote uses a typical organization; once your draft is prepared, the hours are recalculated from
              your real numbers. The time standards are working estimates that we will refine with timings from our own
              reviewers.
            </p>
          </div>
          <div>
            <h3 className="text-xl font-bold">2. Living wage: {formatUsdCents(LABOR_PLEDGE.hourlyWage)} an hour</h3>
            <p className="mt-1">
              We value those hours at {LABOR_PLEDGE.wageBasis}. The{" "}
              <a href={LABOR_PLEDGE.wageSource} rel="noopener noreferrer">
                MIT Living Wage Calculator
              </a>{" "}
              estimates what a full-time worker must earn to cover basic costs where they live. MIT does not publish a
              single national figure, so we average its state figures, counting each state equally.
            </p>
          </div>
          <div>
            <h3 className="text-xl font-bold">3. Contribution rate: {RATE}</h3>
            <p className="mt-1">
              {RATE} is {LABOR_PLEDGE.rateBasis}: 6.2% paid by employers and 6.2% paid by employees. It is what Social
              Security would have collected if a person had been paid for the work.
            </p>
          </div>
        </div>

        <h2 className="mt-8 text-2xl font-bold">Our commitments</h2>
        <ul className="mt-3 list-disc space-y-1 pl-6">
          <li>The contribution is paid out of our fee. It is never added to your price.</li>
          <li>Every quote shows the estimated hours, the task breakdown, and the dollar amount.</li>
          <li>
            Contributions go to {LABOR_PLEDGE.recipient}.
          </li>
          <li>The method on this page is the same code that calculates your quote.</li>
        </ul>

        </div>
      </article>

      <h2 className="mb-3 text-2xl font-bold">Worked examples</h2>

      <div className="grid gap-x-5 lg:grid-cols-2">
        {EXAMPLES.map((e) => (
          <Example key={e.title} {...e} />
        ))}
      </div>

      <p className="text-sm">
        <Link href="/" className={buttonClass("quiet")}>
          &lt; Back to easier.company
        </Link>
      </p>
    </Shell>
  );
}
