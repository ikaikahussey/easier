import type { Cents } from "@/core/money";
import type { ReviewSection } from "@/core/product";
import { fields, table } from "@/core/render";
import type { NonprofitLedger } from "@/domains/nonprofit/ledger";
import { amt, cents, defineSchedule, TIE, usd } from "./common";

/**
 * Schedule G: Supplemental Information Regarding Fundraising or Gaming Activities.
 * Part I: professional fundraisers. Part II: fundraising events (two largest in
 * columns (a) and (b), the rest combined in (c)). Part III: gaming.
 */

export interface FundraisingEvent {
  name: string;
  grossReceipts: number;
  contributions?: number;
  cashPrizes?: number;
  noncashPrizes?: number;
  rent?: number;
  food?: number;
  entertainment?: number;
  otherDirect?: number;
}

export const GAMING_TYPES = [
  { value: "bingo", label: "Bingo" },
  { value: "pull_tabs", label: "Pull tabs, instant bingo, progressive bingo" },
  { value: "other", label: "Other gaming (raffles and similar)" },
] as const;

export interface ScheduleGIntake {
  fundraisingMethods?: string;
  fundraisers?: { name: string; activity: string; custody?: boolean; grossReceipts: number; paidToFundraiser: number }[];
  solicitationStates?: string;
  events?: FundraisingEvent[];
  gaming?: { type: (typeof GAMING_TYPES)[number]["value"]; grossIncome: number; cashPrizes?: number; noncashPrizes?: number; rent?: number; otherDirect?: number; volunteerPct?: number }[];
  gamingStates?: string;
}

/** Event receipts above the fair value of benefits to attendees are contributions (Part VIII line 1c). */
export const eventContributions = (events: FundraisingEvent[] = []): Cents =>
  events.reduce((t, e) => t + Math.min(cents(e.contributions), cents(e.grossReceipts)), 0);

/**
 * Move the contribution portion of event receipts from line 8a (where books usually
 * record all event revenue) to line 1c. Total revenue and gross receipts are unchanged.
 */
export function applyEventSplit(ledger: NonprofitLedger, events?: FundraisingEvent[]): NonprofitLedger {
  const booked = ledger.lines["VIII.8a"] ?? 0;
  const move = Math.min(eventContributions(events), Math.max(0, booked));
  if (move <= 0) return ledger;
  const lines = { ...ledger.lines, "VIII.8a": booked - move, "VIII.1c": (ledger.lines["VIII.1c"] ?? 0) + move };
  return { ...ledger, lines };
}

interface EventColumn {
  label: string;
  grossReceipts: Cents;
  contributions: Cents;
  grossIncome: Cents;
  cashPrizes: Cents;
  noncashPrizes: Cents;
  rent: Cents;
  food: Cents;
  entertainment: Cents;
  otherDirect: Cents;
  direct: Cents;
  net: Cents;
}

export interface ScheduleGOut {
  fundraisers: { name: string; activity: string; custody: boolean; grossReceipts: Cents; paid: Cents; toOrg: Cents }[];
  events: { columns: EventColumn[]; total: EventColumn; otherCount: number };
  gaming: { columns: { label: string; grossIncome: Cents; cashPrizes: Cents; noncashPrizes: Cents; rent: Cents; otherDirect: Cents; volunteerPct?: number; direct: Cents; net: Cents }[]; total: { grossIncome: Cents; direct: Cents; net: Cents } };
  /** Event revenue as booked, before the contribution split. */
  bookedEventRevenue: Cents;
  bookedEventExpenses: Cents;
  bookedGaming: Cents;
  part: { I: boolean; II: boolean; III: boolean };
}

function eventColumn(label: string, list: FundraisingEvent[]): EventColumn {
  const s = (k: keyof FundraisingEvent) => list.reduce((t, e) => t + cents(e[k] as number | undefined), 0);
  const grossReceipts = s("grossReceipts");
  const contributions = eventContributions(list);
  const direct = s("cashPrizes") + s("noncashPrizes") + s("rent") + s("food") + s("entertainment") + s("otherDirect");
  const grossIncome = grossReceipts - contributions;
  return {
    label, grossReceipts, contributions, grossIncome,
    cashPrizes: s("cashPrizes"), noncashPrizes: s("noncashPrizes"), rent: s("rent"), food: s("food"),
    entertainment: s("entertainment"), otherDirect: s("otherDirect"), direct, net: grossIncome - direct,
  };
}

export const scheduleG = defineSchedule<ScheduleGOut>({
  schedule: "G",
  title: "Fundraising or Gaming Activities",
  intake: [
    {
      title: "Schedule G: fundraising events, fundraisers, and gaming",
      help: "List every fundraising event (galas, dinners, auctions, golf tournaments). Contributions are what attendees paid above the fair value of what they received; for a $250 dinner ticket with a $90 meal, $160 is a contribution.",
      collapsible: true,
      fields: [
        {
          name: "events",
          type: "list",
          label: "Fundraising events",
          rows: 3,
          fields: [
            { name: "name", type: "text", label: "Event", required: true },
            { name: "grossReceipts", type: "money", label: "Gross receipts: tickets, sponsorships, auction sales ($)", required: true },
            { name: "contributions", type: "money", label: "Of which contributions, above fair value of benefits ($)" },
            { name: "cashPrizes", type: "money", label: "Cash prizes ($)" },
            { name: "noncashPrizes", type: "money", label: "Noncash prizes ($)" },
            { name: "rent", type: "money", label: "Rent and facility costs ($)" },
            { name: "food", type: "money", label: "Food and beverages ($)" },
            { name: "entertainment", type: "money", label: "Entertainment ($)" },
            { name: "otherDirect", type: "money", label: "Other direct expenses ($)" },
          ],
        },
        {
          name: "fundraisers",
          type: "list",
          label: "Paid fundraising consultants or solicitors",
          rows: 3,
          fields: [
            { name: "name", type: "text", label: "Name", required: true },
            { name: "activity", type: "text", label: "Activity (e.g. direct mail, telemarketing, event management)", required: true },
            { name: "custody", type: "checkbox", label: "Fundraiser had custody or control of contributions" },
            { name: "grossReceipts", type: "money", label: "Gross receipts from the activity ($)", required: true },
            { name: "paidToFundraiser", type: "money", label: "Amount paid to or retained by the fundraiser ($)", required: true },
          ],
        },
        { name: "fundraisingMethods", type: "text", label: "Fundraising methods used (mail, email, phone, in person, grant applications, events)" },
        { name: "solicitationStates", type: "text", label: "States where the organization is registered or licensed to solicit contributions" },
        {
          name: "gaming",
          type: "list",
          label: "Gaming (bingo, pull tabs, raffles)",
          rows: 3,
          fields: [
            { name: "type", type: "select", label: "Type", required: true, options: GAMING_TYPES },
            { name: "grossIncome", type: "money", label: "Gross income ($)", required: true },
            { name: "cashPrizes", type: "money", label: "Cash prizes ($)" },
            { name: "noncashPrizes", type: "money", label: "Noncash prizes ($)" },
            { name: "rent", type: "money", label: "Rent and facility costs ($)" },
            { name: "otherDirect", type: "money", label: "Other direct expenses ($)" },
            { name: "volunteerPct", type: "percent", label: "Share of labor done by volunteers (%)" },
          ],
        },
        { name: "gamingStates", type: "text", label: "States where the organization conducts gaming" },
      ],
    },
  ],

  build(f) {
    const i = f.intake;
    const events = [...(i.events ?? [])].sort((a, b) => cents(b.grossReceipts) - cents(a.grossReceipts));
    const columns = events.slice(0, 2).map((e) => eventColumn(e.name, [e]));
    const rest = events.slice(2);
    if (rest.length) columns.push(eventColumn(`Other events (${rest.length})`, rest));
    const gaming = GAMING_TYPES.flatMap(({ value, label }) => {
      const rows = (i.gaming ?? []).filter((g) => g.type === value);
      if (!rows.length) return [];
      const s = (k: "grossIncome" | "cashPrizes" | "noncashPrizes" | "rent" | "otherDirect") => rows.reduce((t, g) => t + cents(g[k]), 0);
      const direct = s("cashPrizes") + s("noncashPrizes") + s("rent") + s("otherDirect");
      return [{ label, grossIncome: s("grossIncome"), cashPrizes: s("cashPrizes"), noncashPrizes: s("noncashPrizes"), rent: s("rent"), otherDirect: s("otherDirect"), volunteerPct: rows[0]!.volunteerPct, direct, net: s("grossIncome") - direct }];
    });
    const gTotal = gaming.reduce((t, g) => ({ grossIncome: t.grossIncome + g.grossIncome, direct: t.direct + g.direct, net: t.net + g.net }), { grossIncome: 0, direct: 0, net: 0 });
    return {
      fundraisers: (i.fundraisers ?? []).map((x) => ({
        name: x.name, activity: x.activity, custody: !!x.custody,
        grossReceipts: cents(x.grossReceipts), paid: cents(x.paidToFundraiser), toOrg: cents(x.grossReceipts) - cents(x.paidToFundraiser),
      })),
      events: { columns, total: eventColumn("Total", events), otherCount: rest.length },
      gaming: { columns: gaming, total: gTotal },
      // The ledger seen here is already split; add the moved contributions back to compare with the books.
      bookedEventRevenue: amt(f, "VIII.8a") + f.eventSplit,
      bookedEventExpenses: amt(f, "VIII.8b"),
      bookedGaming: amt(f, "VIII.9a"),
      part: { I: f.parts.has("G-I"), II: f.parts.has("G-II"), III: f.parts.has("G-III") },
    };
  },

  rules: [
    {
      id: "g.fundraisers_listed",
      severity: "error",
      ref: "Schedule G, Part I line 3",
      description: "Professional fundraisers are listed",
      check: ({ out }) => (out.part.I && !out.fundraisers.length ? "List each professional fundraiser paid more than $5,000" : undefined),
    },
    {
      id: "g.events_listed",
      severity: "error",
      ref: "Schedule G, Part II",
      description: "Fundraising events are listed",
      check: ({ out }) => (out.part.II && !out.events.columns.length ? "List the fundraising events with receipts and direct expenses" : undefined),
    },
    {
      id: "g.event_receipts_tie",
      severity: "warning",
      ref: "Part VIII, lines 1c and 8a",
      description: "Event receipts entered agree with event revenue in the books",
      check: ({ out }) =>
        out.events.columns.length && Math.abs(out.events.total.grossReceipts - out.bookedEventRevenue) > TIE
          ? `Events entered total ${usd(out.events.total.grossReceipts)} of gross receipts; the books show ${usd(out.bookedEventRevenue)} of event revenue. If part of the receipts was booked as contributions, the split will double count.`
          : undefined,
    },
    {
      id: "g.event_expenses_tie",
      severity: "warning",
      ref: "Part VIII, line 8b",
      description: "Direct event expenses agree with the books",
      check: ({ out }) =>
        out.events.columns.length && Math.abs(out.events.total.direct - out.bookedEventExpenses) > TIE
          ? `Direct event expenses entered total ${usd(out.events.total.direct)}; the books show ${usd(out.bookedEventExpenses)} on line 8b`
          : undefined,
    },
    {
      id: "g.gaming_tie",
      severity: "warning",
      ref: "Part VIII, line 9a",
      description: "Gaming income agrees with the books",
      check: ({ out }) =>
        out.gaming.columns.length && Math.abs(out.gaming.total.grossIncome - out.bookedGaming) > TIE
          ? `Gaming entered totals ${usd(out.gaming.total.grossIncome)}; the books show ${usd(out.bookedGaming)}`
          : undefined,
    },
    {
      id: "g.gaming_listed",
      severity: "error",
      ref: "Schedule G, Part III",
      description: "Gaming activity is detailed",
      check: ({ out }) => (out.part.III && !out.gaming.columns.length ? "Enter gaming income and direct expenses by type" : undefined),
    },
    {
      id: "g.gaming_questions",
      severity: "info",
      ref: "Schedule G, Part III lines 9–17",
      description: "Gaming compliance questions",
      check: ({ out }) =>
        out.gaming.columns.length
          ? "Answer Part III lines 9–17 (state licensing, gaming conducted with nonmembers, facilities, managers) with the client"
          : undefined,
    },
  ],

  render(out, f) {
    const s: ReviewSection[] = [];
    if (out.fundraisers.length || out.part.I)
      s.push(
        table(
          "sched-g-1",
          "Schedule G Part I: professional fundraisers",
          [["name", "(i) Name"], ["activity", "(ii) Activity"], ["custody", "(iii) Custody of contributions"], ["gross", "(iv) Gross receipts", true], ["paid", "(v) Paid to fundraiser", true], ["toOrg", "(vi) Paid to organization", true]],
          out.fundraisers.map((x) => ({ name: x.name, activity: x.activity, custody: x.custody ? "Yes" : "No", gross: usd(x.grossReceipts), paid: usd(x.paid), toOrg: usd(x.toOrg) })),
          { note: [f.intake.fundraisingMethods && `Methods: ${f.intake.fundraisingMethods}.`, f.intake.solicitationStates && `Registered to solicit in: ${f.intake.solicitationStates}.`].filter(Boolean).join(" ") || undefined },
        ),
      );
    if (out.events.columns.length) {
      const cols = out.events.columns;
      const keys = cols.map((_, i) => `c${i}`);
      const row = (line: string, label: string, pick: (c: EventColumn) => Cents) => ({
        line, label, ...Object.fromEntries(cols.map((c, i) => [keys[i], usd(pick(c))])), total: usd(pick(out.events.total)),
      });
      s.push(
        table(
          "sched-g-2",
          "Schedule G Part II: fundraising events",
          [["line", "Line"], ["label", "Description"], ...cols.map((c, i) => [keys[i]!, `(${"abc"[i]}) ${c.label}`, true] as [string, string, boolean]), ["total", "(d) Total", true]],
          [
            row("1", "Gross receipts", (c) => c.grossReceipts),
            row("2", "Less: contributions (Part VIII line 1c)", (c) => c.contributions),
            row("3", "Gross income (Part VIII line 8a)", (c) => c.grossIncome),
            row("4", "Cash prizes", (c) => c.cashPrizes),
            row("5", "Noncash prizes", (c) => c.noncashPrizes),
            row("6", "Rent and facility costs", (c) => c.rent),
            row("7", "Food and beverages", (c) => c.food),
            row("8", "Entertainment", (c) => c.entertainment),
            row("9", "Other direct expenses", (c) => c.otherDirect),
            row("10", "Direct expense summary (Part VIII line 8b)", (c) => c.direct),
            row("11", "Net income", (c) => c.net),
          ],
          { note: "The contribution portion has been moved from Part VIII line 8a to line 1c on this return." },
        ),
      );
    }
    if (out.gaming.columns.length)
      s.push(
        table(
          "sched-g-3",
          "Schedule G Part III: gaming",
          [["label", "Type"], ["gross", "Gross income", true], ["cash", "Cash prizes", true], ["noncash", "Noncash prizes", true], ["rent", "Rent", true], ["other", "Other direct", true], ["volunteer", "Volunteer labor %", true], ["net", "Net gaming income", true]],
          out.gaming.columns.map((g) => ({ label: g.label, gross: usd(g.grossIncome), cash: usd(g.cashPrizes), noncash: usd(g.noncashPrizes), rent: usd(g.rent), other: usd(g.otherDirect), volunteer: g.volunteerPct === undefined ? "—" : `${g.volunteerPct}%`, net: usd(g.net) })),
          { footer: { label: "Total", gross: usd(out.gaming.total.grossIncome), cash: "", noncash: "", rent: "", other: "", volunteer: "", net: usd(out.gaming.total.net) }, note: f.intake.gamingStates ? `Gaming conducted in: ${f.intake.gamingStates}.` : undefined },
        ),
      );
    if (!s.length) s.push(fields("sched-g", "Schedule G", [["Status", "No fundraising or gaming detail entered"]]));
    return s;
  },
});
