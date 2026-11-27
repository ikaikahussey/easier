import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { p120Action } from "@/app/p120/actions";
import { NotFoundError } from "@/core/services/context";
import {
  audit,
  clearance,
  contractorUncovered,
  deadlines,
  formatIn,
  functionNames,
  misCounts,
  misStatus,
  obligations,
  openItems,
  pool,
  priorRecordsComplete,
  quarterOf,
  randomStatus,
  records,
  RULES,
  todayIn,
  verifiedNegative,
  type View,
} from "@/programs/part-120/rules";
import { getDesk, part120Enabled, recentLog } from "@/programs/part-120/service";
import { FUNCTIONS, OPERATIONS, TEST_REASONS, TIME_ZONES, type Person, type State, type Test, type WithId } from "@/programs/part-120/types";
import { Button, buttonClass, Card, inputClass, Notice, PageTitle, Shell } from "@/ui/components";
import { requireActor } from "@/ui/session";

const VIEWS: [View, string][] = [
  ["dashboard", "Dashboard"],
  ["roster", "Roster"],
  ["random", "Random"],
  ["events", "Events"],
  ["records", "Records"],
  ["contractors", "Contractors"],
  ["audit", "Audit"],
  ["mis", "Annual report"],
];

type Tone = "ok" | "warn" | "danger" | "muted";
const TONE: Record<Tone, string> = { ok: "border-ok text-ok", warn: "border-warn text-warn", danger: "border-danger text-danger", muted: "border-muted text-muted" };
const Pill = ({ tone, children }: { tone: Tone; children: ReactNode }) => (
  <span className={`inline-block whitespace-nowrap border-2 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${TONE[tone]}`}>{children}</span>
);

const Label = ({ text, children }: { text: string; children: ReactNode }) => (
  <label className="block min-w-0">
    <span className="mb-1 block text-sm font-medium">{text}</span>
    {children}
  </label>
);

function remaining(until: string, now: Date): string {
  const ms = new Date(until).getTime() - now.getTime();
  if (ms <= 0) return "window closed";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h} h ${m} min left`;
}

export default async function Part120Desk({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ view?: string; error?: string; open?: string }>;
}) {
  if (!part120Enabled()) notFound();
  const actor = await requireActor();
  if (actor.role !== "client") redirect("/review");
  const { orgId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) notFound();
  const { view: rawView, error, open } = await searchParams;
  const view = (VIEWS.find(([v]) => v === rawView)?.[0] ?? "dashboard") as View;

  const desk = await getDesk(actor, orgId).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });

  /** A form that posts one operation back to this view. */
  const Op = ({ op, id, person, hidden, className, children }: { op: string; id?: string; person?: string; hidden?: Record<string, string>; className?: string; children: ReactNode }) => (
    <form action={p120Action} className={className ?? "flex flex-wrap items-end gap-3"}>
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="view" value={view} />
      <input type="hidden" name="op" value={op} />
      {id && <input type="hidden" name="id" value={id} />}
      {person && <input type="hidden" name="person" value={person} />}
      {Object.entries(hidden ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {children}
    </form>
  );

  if (!desk.program || !desk.state) {
    return (
      <Shell actor={actor}>
        <Notice error={error} />
        <PageTitle kicker={desk.orgName}>Part 120 Compliance Desk</PageTitle>
        <Card title="Start the program">
          <p className="mb-4 max-w-2xl text-sm text-muted">
            For employers with an FAA drug and alcohol testing program under 14 CFR part 120. You become the designated employer representative for this program. That role must be held by
            your own organization; easier.company acts as a service agent and makes no determinations.
          </p>
          <Op op="enroll" className="grid gap-4 sm:grid-cols-2">
            <Label text="Operation *">
              <select name="operation" required className={inputClass}>
                {Object.entries(OPERATIONS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Label>
            <Label text="Time zone for dates and clocks *">
              <select name="timeZone" required className={inputClass}>
                {TIME_ZONES.map((z) => (
                  <option key={z}>{z}</option>
                ))}
              </select>
            </Label>
            <Label text="How the program is registered *">
              <select name="registrationKind" required className={inputClass}>
                <option value="a449">Operations specification paragraph A449</option>
                <option value="registration">Registration with the Drug Abatement Division</option>
              </select>
            </Label>
            <Label text="Registration reference *">
              <input name="registrationRef" required maxLength={80} className={inputClass} />
            </Label>
            <div className="sm:col-span-2">
              <Button type="submit">Start program</Button>
            </div>
          </Op>
        </Card>
      </Shell>
    );
  }

  const s: State = desk.state;
  const tz = s.program.timeZone;
  const now = new Date();
  const today = todayIn(tz, now);
  const year = Number(today.slice(0, 4));
  const nameOf = (id: string) => s.people.find((p) => p.id === id)?.name ?? "Unknown";
  const current = s.people.filter((p) => !p.separatedOn || p.separatedOn > today);
  const items = openItems(s, now);
  const rs = randomStatus(s, year, today);
  const duePersonal = obligations(s).filter((o) => !o.doneOn);

  /** Result entry for a test that has, or does not need, a collection time. */
  const ResultForm = ({ t, person }: { t: WithId<Test>; person?: string }) => (
    <Op op="result" id={t.id} person={person}>
      <Label text="Verified result">
        <select name="result" required className={inputClass}>
          <option value="negative">{t.substance === "drug" ? "Negative" : "Below 0.02"}</option>
          {t.substance === "alcohol" && <option value="low">0.02 to 0.039</option>}
          <option value="positive">{t.substance === "drug" ? "Verified positive" : "0.04 or greater"}</option>
          <option value="refusal">Refusal to test</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </Label>
      {!t.collectedAt && (
        <Label text="Collected on">
          <input type="date" name="collectedOn" max={today} className={inputClass} />
        </Label>
      )}
      <Label text="Verified on">
        <input type="date" name="verifiedOn" required max={today} className={inputClass} />
      </Label>
      <Button type="submit" variant="quiet">
        Record result
      </Button>
    </Op>
  );

  const NotAdministered = ({ t }: { t: WithId<Test> }) => (
    <Op op="not_administered" id={t.id}>
      <Label text="Reason no test was administered">
        <input name="reason" required maxLength={500} className={inputClass} />
      </Label>
      <Button type="submit" variant="quiet">
        Record reason
      </Button>
    </Op>
  );

  const FunctionBoxes = () => (
    <fieldset className="sm:col-span-2">
      <legend className="mb-1 text-sm font-medium">Safety-sensitive functions</legend>
      <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {Object.entries(FUNCTIONS).map(([k, v]) => (
          <label key={k} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="functions" value={k} /> {v}
          </label>
        ))}
      </div>
    </fieldset>
  );

  function PersonFile({ p }: { p: WithId<Person> }) {
    const c = clearance(p, s.tests, today);
    const mine = s.tests.filter((t) => t.personId === p.id);
    const pre = mine.filter((t) => t.reason === "pre_employment" && t.substance === "drug");
    const pending = pre.find((t) => !t.result);
    const negative = verifiedNegative(p.id, s.tests);
    const Line = ({ ok, children }: { ok: boolean; children: ReactNode }) => (
      <li className="flex gap-2">
        <span aria-hidden className={ok ? "text-ok" : "text-danger"}>
          {ok ? "✓" : "✗"}
        </span>
        <span>{children}</span>
      </li>
    );
    return (
      <details className="border-t border-line py-3 first:border-t-0" open={open === p.id}>
        <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3">
          <span>
            <b>{p.name}</b>
            <span className="block text-sm text-muted">
              {p.title} · {functionNames(p.functions)}
              {p.contractorId && ` · ${s.contractors.find((k) => k.id === p.contractorId)?.name ?? "Contractor"}`}
            </span>
          </span>
          <Pill tone={c.cleared ? "ok" : "danger"}>{c.cleared ? (p.firstDutyOn ? "On duty" : "Cleared") : "Blocked"}</Pill>
        </summary>
        <div className="mt-3 space-y-4 text-sm">
          {!c.cleared && <p className="font-bold text-danger">Blocked from safety-sensitive duty. {c.blockers.join(". ")}.</p>}
          {c.warnings.map((w) => (
            <p key={w} className="text-warn">
              {w}.
            </p>
          ))}
          <ul className="space-y-1">
            <Line ok={!!negative}>Verified negative pre-employment drug result: {negative ?? (pending ? `ordered ${pending.orderedOn}, pending` : "not ordered")}</Line>
            <Line ok={!!p.consentOn}>Written consent to prior-employer request: {p.consentRefused ? "refused" : (p.consentOn ?? "none")}</Line>
            <Line ok={!!p.askedOn}>Asked about pre-employment positives or refusals: {p.askedOn ? `${p.askedOn}${p.admitted ? " (reported one)" : ""}` : "not yet"}</Line>
            <Line ok={priorRecordsComplete(p) || !!p.goodFaithOn}>
              Prior-employer records: {p.noPriorDot ? "no DOT-regulated employer in the past two years" : p.priorEmployers.length ? `${p.priorEmployers.filter((e) => e.receivedOn).length} of ${p.priorEmployers.length} received` : "none listed"}
              {p.goodFaithOn && `; good-faith effort documented ${p.goodFaithOn}`}
            </Line>
            <Line ok={p.training.some((t) => t.kind === "employee")}>Employee training: {p.training.filter((t) => t.kind === "employee").map((t) => t.on).join(", ") || "none"}</Line>
            {p.supervisor && (
              <Line ok={["supervisor_drug", "supervisor_alcohol"].every((k) => p.training.filter((t) => t.kind === k).reduce((m, t) => m + t.minutes, 0) >= RULES.supervisorMinutes)}>
                Supervisor training: {p.training.filter((t) => t.kind !== "employee").map((t) => `${t.kind === "supervisor_drug" ? "drug" : "alcohol"} ${t.minutes} min on ${t.on}`).join("; ") || "none"}
              </Line>
            )}
            <Line ok={!!p.firstDutyOn}>First safety-sensitive duty: {p.firstDutyOn ?? "not assigned"}</Line>
          </ul>

          {duePersonal
            .filter((o) => o.personId === p.id)
            .map((o) => (
              <Op key={o.testId + o.to} op="reported" id={o.testId} person={p.id} hidden={{ to: o.to }}>
                <span className="font-bold text-danger">
                  {o.label}. Due {o.dueOn}.
                </span>
                <Label text="Sent on">
                  <input type="date" name="on" required max={today} className={inputClass} />
                </Label>
                <Button type="submit" variant="quiet">
                  Mark sent
                </Button>
              </Op>
            ))}

          {!negative && !pending && (
            <Op op="order_test" id={p.id} person={p.id} hidden={{ reason: "pre_employment", substance: "drug" }}>
              <Label text="Ordered on">
                <input type="date" name="on" defaultValue={today} max={today} className={inputClass} />
              </Label>
              <Button type="submit" variant="quiet">
                Order pre-employment drug test
              </Button>
            </Op>
          )}
          {pending && <ResultForm t={pending} person={p.id} />}

          {!p.consentOn && !p.consentRefused && (
            <div className="flex flex-wrap items-end gap-3">
              <Op op="consent" id={p.id} person={p.id}>
                <Label text="Consent signed on">
                  <input type="date" name="on" required max={today} className={inputClass} />
                </Label>
                <Button type="submit" variant="quiet">
                  Record consent
                </Button>
              </Op>
              <Op op="consent" id={p.id} person={p.id} hidden={{ refused: "1" }}>
                <button className={buttonClass("danger")}>Consent refused</button>
              </Op>
            </div>
          )}

          {!p.askedOn && (
            <Op op="asked" id={p.id} person={p.id}>
              <Label text="Asked on">
                <input type="date" name="on" required max={today} className={inputClass} />
              </Label>
              <label className="flex items-center gap-2 pb-2">
                <input type="checkbox" name="admitted" /> Reported a positive or refusal
              </label>
              <Button type="submit" variant="quiet">
                Record answer
              </Button>
            </Op>
          )}

          {!p.noPriorDot && (
            <div className="space-y-2">
              {p.priorEmployers.map((e, i) =>
                e.receivedOn ? (
                  <p key={i}>
                    {e.name}: requested {e.requestedOn}, received {e.receivedOn}
                    {e.violation && <b className="text-danger"> · violation reported</b>}
                  </p>
                ) : (
                  <Op key={i} op="prior_response" id={p.id} person={p.id} hidden={{ index: String(i) }}>
                    <span>
                      {e.name}: {e.requestedOn ? `requested ${e.requestedOn}` : "not yet requested"}
                    </span>
                    <Label text="Response received on">
                      <input type="date" name="receivedOn" required max={today} className={inputClass} />
                    </Label>
                    <label className="flex items-center gap-2 pb-2">
                      <input type="checkbox" name="violation" /> Reports a violation
                    </label>
                    <Button type="submit" variant="quiet">
                      Record response
                    </Button>
                  </Op>
                ),
              )}
              <Op op="prior_employer" id={p.id} person={p.id}>
                <Label text="DOT-regulated employer in the past two years">
                  <input name="name" required maxLength={120} className={inputClass} />
                </Label>
                <Label text="Request sent on">
                  <input type="date" name="requestedOn" max={today} className={inputClass} />
                </Label>
                <Button type="submit" variant="quiet">
                  Add employer
                </Button>
              </Op>
              {!p.priorEmployers.length && (
                <Op op="no_prior_dot" id={p.id} person={p.id}>
                  <button className={buttonClass()}>No DOT-regulated employer in the past two years</button>
                </Op>
              )}
              {p.priorEmployers.length > 0 && !priorRecordsComplete(p) && !p.goodFaithOn && (
                <Op op="good_faith" id={p.id} person={p.id}>
                  <Label text="Good-faith effort: what was done">
                    <input name="note" required maxLength={500} className={inputClass} />
                  </Label>
                  <Label text="Documented on">
                    <input type="date" name="on" required max={today} className={inputClass} />
                  </Label>
                  <Button type="submit" variant="quiet">
                    Record good-faith effort
                  </Button>
                </Op>
              )}
            </div>
          )}

          {c.blockers.some((b) => b.includes("return-to-duty")) && (
            <Op op="return_to_duty" id={p.id} person={p.id}>
              <Label text="Return-to-duty process completed on">
                <input type="date" name="on" required max={today} className={inputClass} />
              </Label>
              <Button type="submit" variant="quiet">
                Record return to duty
              </Button>
            </Op>
          )}

          <Op op="training" id={p.id} person={p.id}>
            <Label text="Training">
              <select name="kind" className={inputClass}>
                <option value="employee">Employee program training</option>
                <option value="supervisor_drug">Supervisor: drug indicators</option>
                <option value="supervisor_alcohol">Supervisor: alcohol indicators</option>
              </select>
            </Label>
            <Label text="Date">
              <input type="date" name="on" required max={today} className={inputClass} />
            </Label>
            <Label text="Minutes">
              <input type="number" name="minutes" required min={1} max={600} defaultValue={60} className={inputClass} />
            </Label>
            <Button type="submit" variant="quiet">
              Record training
            </Button>
          </Op>

          {!p.firstDutyOn ? (
            <Op op="assign_duty" id={p.id} person={p.id}>
              <Label text="First duty on">
                <input type="date" name="on" defaultValue={today} max={today} className={inputClass} />
              </Label>
              <Button type="submit" disabled={!c.cleared}>
                Assign to safety-sensitive duty
              </Button>
            </Op>
          ) : (
            <Op op="separate" id={p.id} person={p.id}>
              <Label text="Left safety-sensitive duty on">
                <input type="date" name="on" required max={today} className={inputClass} />
              </Label>
              <Button type="submit" variant="quiet">
                Record separation
              </Button>
            </Op>
          )}
        </div>
      </details>
    );
  }

  const views: Record<View, () => ReactNode> = {
    dashboard: () => (
      <>
        <div className="mb-6 grid gap-4 sm:grid-cols-4">
          {[
            [current.length, "Covered people"],
            [pool(s, today).length, "On safety-sensitive duty"],
            [items.filter((i) => i.severity === "critical").length, "Critical open items"],
            [`${rs.completed.drug}/${rs.required.drug}`, `Random drug tests, ${year}`],
          ].map(([n, label]) => (
            <div key={label} className="well p-4">
              <div className="text-3xl font-bold tabular-nums">{n}</div>
              <div className="text-sm text-muted">{label}</div>
            </div>
          ))}
        </div>
        <Card title="Open items, most serious first">
          {items.length === 0 && <p>No open items.</p>}
          <ul className="divide-y divide-line">
            {items.map((i, n) => (
              <li key={n} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span className={`border-l-8 pl-3 ${i.severity === "critical" ? "border-danger" : "border-warn"}`}>
                  <b>{i.title}</b>
                  <span className="block text-sm text-muted">{i.detail}</span>
                </span>
                <Link href={`/p120/${orgId}?view=${i.view}`} className={buttonClass()}>
                  Open {VIEWS.find(([v]) => v === i.view)?.[1]}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </>
    ),

    roster: () => (
      <>
        <Card
          title="Roster and clearance gate"
          aside={
            <a href={`/p120/${orgId}/roster.csv`} className="text-inherit!">
              Download roster.csv
            </a>
          }
        >
          <p className="mb-2 text-sm text-muted">
            No one can be assigned to safety-sensitive duty until a verified negative pre-employment drug result, written consent, the direct question, and the prior-employer request are on
            file. Prior-employer records must then arrive, or a good-faith effort be documented, within {RULES.priorEmployerGraceDays} days of first duty.
          </p>
          {current.length === 0 && <p>No one on the roster yet.</p>}
          {current.map((p) => (
            <PersonFile key={p.id} p={p} />
          ))}
        </Card>
        <Card title="Add a hire or transfer">
          <Op op="add_person" className="grid gap-4 sm:grid-cols-2">
            <Label text="Name *">
              <input name="name" required maxLength={120} className={inputClass} />
            </Label>
            <Label text="Job title *">
              <input name="title" required maxLength={80} className={inputClass} />
            </Label>
            <FunctionBoxes />
            <fieldset className="space-y-1 text-sm sm:col-span-2">
              <label className="flex items-center gap-2">
                <input type="checkbox" name="medical" /> Holds or needs a Part 67 airman medical certificate
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="airman" /> Holds a certificate under Part 61, 63, or 65
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="supervisor" /> Makes reasonable-cause determinations
              </label>
            </fieldset>
            <Label text="Hire or transfer date">
              <input type="date" name="hiredOn" max={today} className={inputClass} />
            </Label>
            {s.contractors.some((k) => k.coverage === "our_pool") && (
              <Label text="Works for a contractor covered in this pool">
                <select name="contractorId" className={inputClass}>
                  <option value="">No</option>
                  {s.contractors
                    .filter((k) => k.coverage === "our_pool")
                    .map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.name}
                      </option>
                    ))}
                </select>
              </Label>
            )}
            <div className="sm:col-span-2">
              <Button type="submit">Add to roster</Button>
            </div>
          </Op>
        </Card>
      </>
    ),

    random: () => {
      const quarter = quarterOf(today);
      const drawn = rs.periodsDrawn.includes(quarter);
      const members = pool(s, today).length;
      return (
        <>
          <Card title={`Random testing, ${year}`}>
            <p className="mb-3 text-sm text-muted">
              Pool today: {members}. Average pool across this year's draws: {rs.averagePool.toFixed(1)}. Minimum annual rates: drugs {Math.round(rs.rates.drug * 100)} percent, alcohol{" "}
              {Math.round(rs.rates.alcohol * 100)} percent{rs.ratesConfirmed ? "" : " (not yet confirmed for this year; check the FAA's Federal Register notice)"}.
            </p>
            <table className="mb-4 w-full text-sm">
              <tbody>
                {(["drug", "alcohol"] as const).map((sub) => (
                  <tr key={sub} className="border-t border-line">
                    <th className="py-2 text-left font-medium">{sub === "drug" ? "Drug tests" : "Alcohol tests"}</th>
                    <td className="py-2 text-right tabular-nums">
                      {rs.completed[sub]} of {rs.required[sub]} collected
                    </td>
                    <td className="py-2 pl-4 text-right">
                      <Pill tone={rs.completed[sub] >= rs.required[sub] ? "ok" : "warn"}>{rs.completed[sub] >= rs.required[sub] ? "Met" : "In progress"}</Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Op op="draw">
              <Button type="submit" disabled={drawn || members === 0}>
                Run Q{quarter} draw
              </Button>
              <span className="text-sm text-muted">{drawn ? `The Q${quarter} draw has been run.` : members === 0 ? "No one is on duty yet." : "One draw per quarter. Selection uses a cryptographic random source."}</span>
            </Op>
          </Card>
          {rs.outstanding.length > 0 && (
            <Card title="Selections awaiting a test">
              <div className="space-y-5">
                {rs.outstanding.map((t) => (
                  <div key={t.id} className="space-y-2 border-l-8 border-warn pl-3">
                    <b>
                      {nameOf(t.personId)} · {t.substance} · selected {t.orderedOn}
                    </b>
                    <ResultForm t={t} />
                    <NotAdministered t={t} />
                  </div>
                ))}
              </div>
            </Card>
          )}
          <Card title="Draw history">
            {s.draws.length === 0 && <p>No draws yet.</p>}
            <ul className="divide-y divide-line text-sm">
              {[...s.draws].reverse().map((d) => (
                <li key={d.id} className="py-3">
                  <b>
                    {d.year} Q{d.period}
                  </b>{" "}
                  · {formatIn(tz, d.drawnAt)} · pool of {d.poolIds.length}
                  {d.selections.length === 0 && <span className="block text-muted">No one selected this quarter.</span>}
                  {d.selections.map((x) => {
                    const t = s.tests.find((y) => y.id === x.testId);
                    return (
                      <span key={x.testId} className="block text-muted">
                        {nameOf(x.personId)} · {x.substance} · {t?.notAdministeredReason ? `not administered: ${t.notAdministeredReason}` : t?.result ? "tested" : "awaiting test"}
                      </span>
                    );
                  })}
                </li>
              ))}
            </ul>
          </Card>
        </>
      );
    },

    events: () => {
      const running = s.incidents.some((i) => [i.drugTestId, i.alcoholTestId].some((id) => s.tests.some((t) => t.id === id && !t.collectedAt && !t.result && !t.notAdministeredReason)));
      return (
        <>
          {running && <meta httpEquiv="refresh" content="60" />}
          <Card title="Log an event">
            <Op op="incident" className="grid gap-4 sm:grid-cols-2">
              <Label text="Event *">
                <select name="kind" className={inputClass}>
                  <option value="post_accident">Accident</option>
                  <option value="reasonable_cause">Reasonable cause or suspicion</option>
                </select>
              </Label>
              <Label text="Employee *">
                <select name="personId" required className={inputClass}>
                  {pool(s, today).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Label>
              <Label text={`When it happened (${tz}) *`}>
                <input type="datetime-local" name="occurredLocal" required className={inputClass} />
              </Label>
              <Label text="What happened *">
                <input name="note" required maxLength={1000} className={inputClass} />
              </Label>
              <label className="flex items-start gap-2 text-sm sm:col-span-2">
                <input type="checkbox" name="testingRequired" defaultChecked className="mt-1" />
                <span>
                  Accident only: this employee's performance contributed to the accident or cannot be completely discounted as a contributing factor. Leave unchecked to record a decision not
                  to test.
                </span>
              </label>
              <div className="sm:col-span-2">
                <Button type="submit">Log event and start clocks</Button>
                <p className="mt-2 text-xs text-muted">
                  Alcohol: test within {RULES.alcoholRecordHours} hours or record why; stop at {RULES.alcoholCeaseHours} hours. Post-accident drug test: within {RULES.postAccidentDrugHours}{" "}
                  hours.
                </p>
              </div>
            </Op>
          </Card>
          <Card title="Events">
            {s.incidents.length === 0 && <p>No events logged.</p>}
            <div className="space-y-6">
              {[...s.incidents].reverse().map((i) => {
                const d = deadlines(i);
                const rows = [
                  [s.tests.find((t) => t.id === i.drugTestId), d.drugCeaseAt],
                  [s.tests.find((t) => t.id === i.alcoholTestId), d.alcoholCeaseAt],
                ] as const;
                return (
                  <div key={i.id} className="space-y-3 text-sm">
                    <p>
                      <b>
                        {i.kind === "post_accident" ? "Accident" : "Reasonable cause"} · {nameOf(i.personId)}
                      </b>
                      <span className="block text-muted">
                        {formatIn(tz, i.occurredAt)}. {i.note}
                      </span>
                    </p>
                    {!i.testingRequired && <Pill tone="muted">Decision recorded: no test required</Pill>}
                    {rows.map(([t, cease]) => {
                      if (!t) return null;
                      const label = t.substance === "drug" ? "Drug test" : "Alcohol test";
                      if (t.notAdministeredReason) return <p key={t.id}>{label}: not administered. {t.notAdministeredReason}</p>;
                      if (t.result) return <p key={t.id}>{label}: collected {formatIn(tz, t.collectedAt ?? i.occurredAt)}; result recorded {t.verifiedOn}.</p>;
                      if (t.collectedAt)
                        return (
                          <div key={t.id} className="space-y-2">
                            <p>
                              {label}: collected {formatIn(tz, t.collectedAt)}
                              {t.delayReason && ` (late: ${t.delayReason})`}. Awaiting result.
                            </p>
                            <ResultForm t={t} />
                          </div>
                        );
                      const closed = cease && now.toISOString() > cease;
                      return (
                        <div key={t.id} className="space-y-2 border-l-8 border-danger pl-3">
                          <p className="font-bold">
                            {label}: {cease ? `collect by ${formatIn(tz, cease)} · ${remaining(cease, now)}` : "collect as soon as possible"}
                            {t.substance === "alcohol" && !closed && now.toISOString() > d.alcoholRecordAt && " · past 2 hours: a reason is required"}
                          </p>
                          {!closed && (
                            <Op op="collection" id={t.id}>
                              <Label text={`Collected at (${tz})`}>
                                <input type="datetime-local" name="collectedLocal" required className={inputClass} />
                              </Label>
                              {t.substance === "alcohol" && (
                                <Label text="If after 2 hours, why">
                                  <input name="delayReason" maxLength={500} className={inputClass} />
                                </Label>
                              )}
                              <Button type="submit" variant="quiet">
                                Record collection
                              </Button>
                            </Op>
                          )}
                          <NotAdministered t={t} />
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </Card>
        </>
      );
    },

    records: () => (
      <Card title="Records and minimum retention">
        <p className="mb-3 text-sm text-muted">
          Each record is classed from what was entered and shows the earliest date it may be discarded. Nothing here is deleted automatically, and this list is an index: keep the underlying
          forms and letters in a secure location with controlled access.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted">
                <th className="py-2 pr-4 font-medium">Record</th>
                <th className="py-2 pr-4 font-medium">Class</th>
                <th className="py-2 pr-4 font-medium">Dated</th>
                <th className="py-2 pr-4 font-medium">Keep until</th>
                <th className="py-2 font-medium">Basis</th>
              </tr>
            </thead>
            <tbody>
              {records(s).map((r, n) => (
                <tr key={n} className="border-t border-line align-top">
                  <td className="py-2 pr-4">{r.title}</td>
                  <td className="py-2 pr-4">{r.cls}</td>
                  <td className="py-2 pr-4 tabular-nums">{r.date || "On file"}</td>
                  <td className="py-2 pr-4 tabular-nums">{r.keepUntil ? (r.keepUntil < today ? `Minimum met ${r.keepUntil}` : r.keepUntil) : "While the program is active"}</td>
                  <td className="py-2 text-muted">{r.basis}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    ),

    contractors: () => (
      <>
        <Card title="Contractor coverage">
          <p className="mb-3 text-sm text-muted">
            Anyone who performs a safety-sensitive function by contract, at any tier, must be covered by a testing program: the contractor's own, or this one.
          </p>
          {s.contractors.length === 0 && <p>No contractors listed.</p>}
          <div className="divide-y divide-line">
            {s.contractors.map((k) => {
              const ss = k.functions.length > 0;
              return (
                <div key={k.id} className="space-y-2 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span>
                      <b>{k.name}</b>
                      <span className="block text-muted">
                        {k.work} · {ss ? functionNames(k.functions) : "not a safety-sensitive function; no coverage required"}
                      </span>
                    </span>
                    {!ss ? (
                      <Pill tone="muted">Not safety-sensitive</Pill>
                    ) : contractorUncovered(k) ? (
                      <Pill tone="danger">No coverage on file</Pill>
                    ) : (
                      <Pill tone="ok">{k.coverage === "our_pool" ? "Covered in this pool" : `Own program: ${k.evidenceRef}`}</Pill>
                    )}
                  </div>
                  {ss && (
                    <Op op="coverage" id={k.id}>
                      <Label text="Coverage">
                        <select name="coverage" defaultValue={k.coverage} className={inputClass}>
                          <option value="none">None on file</option>
                          <option value="own_program">Contractor's own program</option>
                          <option value="our_pool">Covered in this pool</option>
                        </select>
                      </Label>
                      <Label text="Their A449 or registration reference">
                        <input name="evidenceRef" defaultValue={k.evidenceRef} maxLength={80} className={inputClass} />
                      </Label>
                      <Label text="Evidence received on">
                        <input type="date" name="evidenceOn" defaultValue={k.evidenceOn} max={today} className={inputClass} />
                      </Label>
                      <Button type="submit" variant="quiet">
                        Save coverage
                      </Button>
                    </Op>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
        <Card title="Add a contractor">
          <Op op="add_contractor" className="grid gap-4 sm:grid-cols-2">
            <Label text="Company *">
              <input name="name" required maxLength={120} className={inputClass} />
            </Label>
            <Label text="Work performed *">
              <input name="work" required maxLength={200} className={inputClass} />
            </Label>
            <FunctionBoxes />
            <div className="sm:col-span-2">
              <Button type="submit">Add contractor</Button>
              <p className="mt-2 text-xs text-muted">Leave every function unchecked for work that is not safety-sensitive, such as fueling.</p>
            </div>
          </Op>
        </Card>
      </>
    ),

    audit: () => null, // filled in below: it needs the log, which is loaded only for this view
    mis: () => {
      const last = misStatus(s, year - 1);
      const draft = misCounts(s, year - 1);
      return (
        <>
          <Card title={`Annual report for ${last.year}`}>
            <p className="mb-3 text-sm">
              <b>{last.reason}.</b> {last.filedOn ? `Recorded as filed ${last.filedOn}.` : last.required ? `Due ${last.dueOn}.` : ""} Covered employees on January 1, {last.year}: {last.coveredOnJan1}.
            </p>
            <div className="overflow-x-auto">
              <table className="mb-4 w-full text-sm">
                <thead>
                  <tr className="text-left text-muted">
                    <th className="py-2 font-medium">Test category</th>
                    <th className="py-2 font-medium">Type</th>
                    <th className="py-2 text-right font-medium">Tests</th>
                    <th className="py-2 text-right font-medium">Positive</th>
                    <th className="py-2 text-right font-medium">Refusals</th>
                    <th className="py-2 text-right font-medium">Cancelled</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.map((r) => (
                    <tr key={r.reason + r.substance} className="border-t border-line">
                      <td className="py-2">{TEST_REASONS[r.reason]}</td>
                      <td className="py-2">{r.substance}</td>
                      <td className="py-2 text-right tabular-nums">{r.tests}</td>
                      <td className="py-2 text-right tabular-nums">{r.positive}</td>
                      <td className="py-2 text-right tabular-nums">{r.refusals}</td>
                      <td className="py-2 text-right tabular-nums">{r.cancelled}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mb-4 text-xs text-muted">
              A draft from the tests recorded here. The report itself is filed on the DOT Management Information System form, and a company official must certify it.
            </p>
            {desk.isDer ? (
              <div className="space-y-4">
                {!last.filedOn && (
                  <Op op="mis_file" hidden={{ year: String(last.year) }}>
                    <Label text="Filed on">
                      <input type="date" name="filedOn" required max={today} className={inputClass} />
                    </Label>
                    <Label text="Certifying official">
                      <input name="certifiedBy" required maxLength={120} className={inputClass} />
                    </Label>
                    <Button type="submit">Record as filed</Button>
                  </Op>
                )}
                <Op op="mis_notice" hidden={{ notified: s.program.misNotified ? "0" : "1" }}>
                  <button className={buttonClass()}>{s.program.misNotified ? "Remove FAA notice to file" : "The FAA notified us in writing to file"}</button>
                </Op>
              </div>
            ) : (
              <p className="text-sm text-muted">Only the designated employer representative can record the filing.</p>
            )}
          </Card>
        </>
      );
    },
  };

  let body: ReactNode;
  if (view === "audit") {
    const checks = audit(s, now);
    const applicable = checks.filter((c) => c.status !== "na");
    const log = await recentLog(actor, orgId);
    const tone: Record<string, [Tone, string]> = { pass: ["ok", "Pass"], finding: ["danger", "Finding"], progress: ["warn", "In progress"], na: ["muted", "N/A"] };
    body = (
      <>
        <Card title="Self-audit" aside={`${applicable.filter((c) => c.status === "pass").length} of ${applicable.length} pass`}>
          <p className="mb-3 text-sm text-muted">Scored from the records in this desk each time the page loads. It covers the areas an FAA inspection reviews; it is not the FAA's own guide.</p>
          <ul className="divide-y divide-line">
            {checks.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span>
                  <b>{c.question}</b>
                  <span className="block text-sm text-muted">
                    {c.detail} · {c.ref}
                  </span>
                </span>
                <Pill tone={tone[c.status]![0]}>{tone[c.status]![1]}</Pill>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Recent activity">
          <ul className="space-y-1 text-sm">
            {log.map((l, n) => (
              <li key={n}>
                <span className="tabular-nums text-muted">{formatIn(tz, l.at.toISOString())}</span> · {l.actor} · {l.type.replace(/_/g, " ")}
              </li>
            ))}
          </ul>
        </Card>
      </>
    );
  } else body = views[view]();

  return (
    <Shell actor={actor}>
      <Notice error={error} />
      <PageTitle kicker={`${desk.orgName} · ${OPERATIONS[s.program.operation]} · representative: ${desk.derName ?? "on file"}`}>Part 120 Compliance Desk</PageTitle>
      <nav aria-label="Part 120 sections" className="no-print mb-6 flex flex-wrap gap-x-5 gap-y-2 border-b-2 border-line pb-3">
        {VIEWS.map(([v, label]) => (
          <Link key={v} href={`/p120/${orgId}?view=${v}`} aria-current={v === view ? "page" : undefined} className={v === view ? "font-bold no-underline!" : ""}>
            {label}
          </Link>
        ))}
      </nav>
      {body}
      <p className="mt-8 text-xs text-muted">
        This desk records what your organization enters and applies fixed rules from 14 CFR part 120 and 49 CFR part 40. It makes no determinations, does not replace your medical review
        officer, collector, or substance abuse professional, and does not transfer your responsibility for the program.
      </p>
    </Shell>
  );
}
