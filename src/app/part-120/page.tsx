import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requestPart120AccessAction } from "@/app/p120/actions";
import { part120Enabled } from "@/programs/part-120/service";
import { Button, Card, inputClass, Notice, PageTitle, Shell } from "@/ui/components";
import { currentActor } from "@/ui/session";

export const metadata: Metadata = {
  title: "Part 120 Compliance Desk — easier.company",
  description: "A compliance desk for FAA drug and alcohol testing programs under 14 CFR part 120. Beta, by invitation.",
};

// The feature flag and the session are read per request; without this the page is fixed at build time.
export const dynamic = "force-dynamic";

const DOES: [string, string][] = [
  ["Clearance before duty", "No one is assigned to a safety-sensitive function until the verified negative pre-employment result, written consent, and prior-employer request are on file."],
  ["Random draws", "A quarterly draw from the people on duty, with progress against the FAA's annual minimum rates."],
  ["Event clocks", "After an accident or a reasonable-cause determination, the time limits for alcohol and drug tests, and a record when a test could not be given."],
  ["Reports due", "The two-working-day reports to the Federal Air Surgeon and the FAA, tracked until sent."],
  ["Records", "An index of every record with the earliest date it may be discarded and the rule behind that date."],
  ["Contractors", "Coverage for anyone who performs safety-sensitive work by contract."],
  ["Self-audit", "A checklist scored from your own records each time you open it."],
  ["Annual report", "Draft counts for the DOT form, and whether you are required to file."],
];

const DOES_NOT = [
  "Replace your consortium or third-party administrator, medical review officer, collector, or substance abuse professional.",
  "Act as your designated employer representative. That role stays with you.",
  "Make any determination. It records what you enter and applies fixed rules.",
  "Give our staff access to your records. Each record is encrypted with your organization's key.",
];

/** Public page for operators. No prices and no guarantee: the desk is in beta and by invitation. */
export default async function Part120Page({ searchParams }: { searchParams: Promise<{ requested?: string; error?: string }> }) {
  if (!part120Enabled()) notFound();
  const actor = await currentActor();
  const { requested, error } = await searchParams;
  return (
    <Shell actor={actor}>
      <PageTitle kicker="For Part 135 operators, air tour operators, and Part 145 repair stations · beta, by invitation">Part 120 Compliance Desk</PageTitle>
      <p className="mb-6 max-w-[68ch] text-[17px]">
        Know where your FAA drug and alcohol testing program stands before an inspector asks. The desk works alongside your consortium or third-party administrator and keeps the
        employer&apos;s side of 14 CFR part 120 in one place.
      </p>
      <Card title="What it does">
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {DOES.map(([t, d]) => (
            <div key={t}>
              <dt className="font-bold">{t}</dt>
              <dd className="text-sm">{d}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card title="What it does not do">
        <ul className="list-disc space-y-1 pl-6 text-sm">
          {DOES_NOT.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </Card>
      <section id="access" className="mx-auto max-w-xl scroll-mt-6">
        <Notice error={error} success={requested ? "Request received. We will email you." : undefined} />
        <Card title="Request access">
          <p className="mb-4 text-sm">We are taking a small number of operators into the beta.</p>
          <form action={requestPart120AccessAction} className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-sm font-bold">Work email</span>
              <input name="email" type="email" required autoComplete="email" className={inputClass} />
            </label>
            <Button type="submit">Request access</Button>
          </form>
        </Card>
      </section>
    </Shell>
  );
}
