import type { CatalogLine, LineCatalog } from "@/core/ledger/catalog";

/**
 * Nonprofit reporting catalog keyed to Form 990 line numbers (Parts VIII, IX, X).
 * The same classification drives monthly statements (Books) and the annual return
 * (Form 990 / 990-EZ), so an account is classified once and reused everywhere.
 */
export interface NonprofitLine extends CatalogLine {
  /** Form 990-EZ line the amount rolls into. */
  ez: string;
  /** Lines reported net within revenue rather than in Part IX. */
  netsAgainstRevenue?: boolean;
}

const L = (
  code: string,
  label: string,
  type: CatalogLine["type"],
  ez: string,
  keywords: string[],
  extra: Partial<NonprofitLine> = {},
): NonprofitLine => ({ code, label, type, ez, keywords, ...extra });

export const NONPROFIT_LINES: NonprofitLine[] = [
  // Part VIII — Revenue
  L("VIII.1a", "Federated campaigns", "revenue", "EZ.1", ["united way", "federated campaign", "combined federal campaign"]),
  L("VIII.1b", "Membership dues", "revenue", "EZ.3", ["membership dues", "member dues", "dues income"]),
  L("VIII.1d", "Related organizations", "revenue", "EZ.1", ["related organization"]),
  L("VIII.1e", "Government grants (contributions)", "revenue", "EZ.1", [
    "government grant", "federal grant", "state grant", "county grant", "city grant", "government contribution",
  ]),
  L("VIII.1f", "All other contributions, gifts, grants", "revenue", "EZ.1", [
    "contribution", "donation", "gift", "grant", "foundation", "giving", "in kind", "sponsorship", "pledge",
  ]),
  L("VIII.2", "Program service revenue", "revenue", "EZ.2", [
    "program service", "program fee", "program revenue", "tuition", "registration fee", "fee for service",
    "service fee", "client fee", "admission", "workshop fee", "contract revenue",
  ]),
  L("VIII.3", "Investment income", "revenue", "EZ.4", ["interest income", "dividend", "investment income", "interest"]),
  L("VIII.6a", "Gross rents", "revenue", "EZ.8", ["rental income", "rent income", "rents"]),
  L("VIII.7d", "Net gain or (loss) from sales of assets", "revenue", "EZ.5c", ["gain on sale", "loss on sale", "sale of assets"]),
  L("VIII.8a", "Gross income from fundraising events", "revenue", "EZ.6b", [
    "fundraising event", "special event", "event revenue", "gala", "benefit dinner", "auction", "event income",
  ]),
  L("VIII.9a", "Gross income from gaming", "revenue", "EZ.6a", ["bingo", "raffle", "gaming"]),
  L("VIII.10a", "Gross sales of inventory", "revenue", "EZ.7a", ["merchandise sales", "book sales", "store sales", "product sales", "sales"]),
  L("VIII.11", "Other revenue", "revenue", "EZ.8", ["miscellaneous income", "misc income", "other income", "other revenue"]),

  // Netted within Part VIII rather than reported in Part IX
  L("VIII.8b", "Direct expenses of fundraising events", "expense", "EZ.6c", [
    "event expense", "special event expense", "gala expense", "fundraising event expense", "direct event",
  ], { netsAgainstRevenue: true }),
  L("VIII.10b", "Cost of goods sold", "expense", "EZ.7b", ["cost of goods sold", "cogs", "cost of sales"], {
    netsAgainstRevenue: true,
  }),

  // Part IX — Functional expenses
  L("IX.1", "Grants to domestic organizations and governments", "expense", "EZ.10", [
    "grants to organizations", "grants paid", "grant expense", "subgrant", "regrant",
  ]),
  L("IX.2", "Grants and assistance to domestic individuals", "expense", "EZ.10", [
    "scholarship", "assistance to individuals", "financial assistance", "direct assistance",
  ]),
  L("IX.3", "Grants and assistance to foreign organizations and individuals", "expense", "EZ.10", ["foreign grant", "international grant"]),
  L("IX.4", "Benefits paid to or for members", "expense", "EZ.11", ["benefits paid to members"]),
  L("IX.5", "Compensation of current officers, directors, trustees, and key employees", "expense", "EZ.12", [
    "officer salar", "officer compensation", "executive director salary", "executive salary", "ceo salary",
  ]),
  L("IX.7", "Other salaries and wages", "expense", "EZ.12", ["salaries", "salary", "wages", "payroll expense", "staff pay"]),
  L("IX.8", "Pension plan accruals and contributions", "expense", "EZ.12", ["pension", "retirement", "401k", "403b", "403 b"]),
  L("IX.9", "Other employee benefits", "expense", "EZ.12", [
    "employee benefits", "health insurance", "medical insurance", "dental insurance", "benefits",
  ]),
  L("IX.10", "Payroll taxes", "expense", "EZ.12", ["payroll tax", "fica", "medicare tax", "futa", "suta", "unemployment tax"]),
  L("IX.11a", "Fees for services: management", "expense", "EZ.13", ["management fee", "management services"]),
  L("IX.11b", "Fees for services: legal", "expense", "EZ.13", ["legal", "attorney"]),
  L("IX.11c", "Fees for services: accounting", "expense", "EZ.13", ["accounting", "audit", "bookkeeping", "tax preparation"]),
  L("IX.11d", "Fees for services: lobbying", "expense", "EZ.13", ["lobbying"]),
  L("IX.11e", "Fees for services: professional fundraising", "expense", "EZ.13", [
    "fundraising consultant", "professional fundraising", "fundraising fees", "fundraising counsel",
  ]),
  L("IX.11f", "Fees for services: investment management", "expense", "EZ.13", ["investment management", "investment fees", "advisory fees"]),
  L("IX.11g", "Fees for services: other", "expense", "EZ.13", [
    "consultant", "consulting", "contract labor", "contractor", "professional fees", "professional services",
  ]),
  L("IX.12", "Advertising and promotion", "expense", "EZ.16", ["advertising", "marketing", "promotion"]),
  L("IX.13", "Office expenses", "expense", "EZ.16", [
    "office supplies", "office expense", "postage", "printing", "supplies", "telephone", "phone", "bank fees",
    "bank charges", "merchant fees",
  ]),
  L("IX.14", "Information technology", "expense", "EZ.16", [
    "software", "information technology", "computer", "website", "internet", "hosting", "it services",
  ]),
  L("IX.15", "Royalties", "expense", "EZ.16", ["royalties"]),
  L("IX.16", "Occupancy", "expense", "EZ.14", ["rent", "occupancy", "utilities", "electric", "water", "janitorial", "repairs"]),
  L("IX.17", "Travel", "expense", "EZ.16", ["travel", "mileage", "airfare", "lodging"]),
  L("IX.18", "Payments of travel or entertainment expenses for public officials", "expense", "EZ.16", ["public officials"]),
  L("IX.19", "Conferences, conventions, and meetings", "expense", "EZ.16", ["conference", "convention", "meeting"]),
  L("IX.20", "Interest", "expense", "EZ.16", ["interest expense", "loan interest", "interest"]),
  L("IX.21", "Payments to affiliates", "expense", "EZ.16", ["payments to affiliates", "affiliate dues"]),
  L("IX.22", "Depreciation, depletion, and amortization", "expense", "EZ.16", ["depreciation", "amortization"]),
  L("IX.23", "Insurance", "expense", "EZ.16", ["insurance", "directors and officers"], {
    exclude: ["health", "medical", "dental", "vision"],
  }),
  L("IX.24", "Other expenses", "expense", "EZ.16", ["miscellaneous", "misc", "other expense", "program supplies"]),

  // Part X — Balance sheet (end of year)
  L("X.1", "Cash — non-interest-bearing", "asset", "EZ.22", ["checking", "cash", "operating account", "petty cash"]),
  L("X.2", "Savings and temporary cash investments", "asset", "EZ.22", ["savings", "money market", "certificate of deposit"]),
  L("X.3", "Pledges and grants receivable, net", "asset", "EZ.24", ["pledges receivable", "grants receivable", "contributions receivable", "pledge"]),
  L("X.4", "Accounts receivable, net", "asset", "EZ.24", ["accounts receivable", "receivable"]),
  L("X.7", "Notes and loans receivable, net", "asset", "EZ.24", ["notes receivable", "loans receivable", "loan receivable"]),
  L("X.8", "Inventories for sale or use", "asset", "EZ.24", ["inventory", "inventories"]),
  L("X.9", "Prepaid expenses and deferred charges", "asset", "EZ.24", ["prepaid", "deferred charges"]),
  L("X.10", "Land, buildings, and equipment, net", "asset", "EZ.23", [
    "equipment", "furniture", "building", "land", "vehicle", "leasehold", "accumulated depreciation", "fixed asset",
  ]),
  L("X.11", "Investments — publicly traded securities", "asset", "EZ.22", ["investment", "brokerage", "stocks", "mutual fund", "securities"]),
  L("X.15", "Other assets", "asset", "EZ.24", ["deposit", "right of use", "other asset"]),
  L("X.17", "Accounts payable and accrued expenses", "liability", "EZ.26", [
    "accounts payable", "accrued", "payable", "credit card", "payroll liabilit",
  ]),
  L("X.18", "Grants payable", "liability", "EZ.26", ["grants payable"]),
  L("X.19", "Deferred revenue", "liability", "EZ.26", ["deferred revenue", "unearned", "refundable advance"]),
  L("X.23", "Secured mortgages and notes payable to unrelated third parties", "liability", "EZ.26", ["mortgage", "secured"]),
  L("X.24", "Unsecured notes and loans payable to unrelated third parties", "liability", "EZ.26", [
    "loan payable", "note payable", "notes payable", "line of credit", "loan",
  ]),
  L("X.25", "Other liabilities", "liability", "EZ.26", ["lease liability", "other liabilit"]),
  L("X.27", "Net assets without donor restrictions", "equity", "EZ.27", [
    "without donor restriction", "unrestricted", "net assets", "fund balance", "retained", "opening balance equity",
  ]),
  L("X.28", "Net assets with donor restrictions", "equity", "EZ.27", [
    "with donor restriction", "temporarily restricted", "permanently restricted", "restricted",
  ]),
];

export const NONPROFIT_CATALOG: LineCatalog & { lines: NonprofitLine[] } = {
  id: "nonprofit-990",
  lines: NONPROFIT_LINES,
  fallback: { revenue: "VIII.11", expense: "IX.24", asset: "X.15", liability: "X.25", equity: "X.27" },
};

export const EZ_LABELS: Record<string, string> = {
  "EZ.1": "Contributions, gifts, grants, and similar amounts received",
  "EZ.2": "Program service revenue",
  "EZ.3": "Membership dues and assessments",
  "EZ.4": "Investment income",
  "EZ.5c": "Gain or (loss) from sale of assets",
  "EZ.6a": "Gaming gross income",
  "EZ.6b": "Fundraising events gross income",
  "EZ.6c": "Less: direct expenses of gaming and fundraising events",
  "EZ.7a": "Gross sales of inventory",
  "EZ.7b": "Less: cost of goods sold",
  "EZ.8": "Other revenue",
  "EZ.10": "Grants and similar amounts paid",
  "EZ.11": "Benefits paid to or for members",
  "EZ.12": "Salaries, other compensation, and employee benefits",
  "EZ.13": "Professional fees and other payments to independent contractors",
  "EZ.14": "Occupancy, rent, utilities, and maintenance",
  "EZ.16": "Other expenses",
  "EZ.22": "Cash, savings, and investments",
  "EZ.23": "Land and buildings",
  "EZ.24": "Other assets",
  "EZ.26": "Total liabilities",
  "EZ.27": "Net assets or fund balances",
};

export const nonprofitLine = (code: string) => NONPROFIT_LINES.find((l) => l.code === code);

/** Expense lines reported net within revenue (event costs, cost of goods sold). */
export const isNettedLine = (code: string) => nonprofitLine(code)?.netsAgainstRevenue === true;
