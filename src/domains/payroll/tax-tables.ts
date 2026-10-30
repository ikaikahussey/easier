import type { Cents } from "@/core/money";

/**
 * Payroll tax parameters, one set per calendar year. A pay run whose pay date falls in a
 * year with no entry here is blocked (rule payroll.tax_year), so stale tables can never
 * silently price a paycheck. Add the next year's entry from the primary sources named
 * on each field before the first January pay date.
 */

export type FederalFilingStatus = "single" | "married" | "head";
export type HawaiiFilingStatus = "single" | "married";

/** One row of an annual percentage-method schedule: wages at least `from` pay `base` plus `rate` of the excess over `from`. */
export interface Bracket {
  from: Cents;
  base: Cents;
  rate: number;
}

export interface FederalTables {
  /** Pub 15-T, Worksheet 1A, line 1j: added back for a 2020-or-later W-4 without the Step 2 box checked. */
  step2UncheckedAdjustment: Record<FederalFilingStatus, Cents>;
  standard: Record<FederalFilingStatus, Bracket[]>;
  step2Checked: Record<FederalFilingStatus, Bracket[]>;
  socialSecurityRate: number;
  socialSecurityWageBase: Cents;
  medicareRate: number;
  additionalMedicareRate: number;
  additionalMedicareThreshold: Cents;
  /** Net FUTA rate after the full state credit, and the wage base it applies to. */
  futaRate: number;
  futaWageBase: Cents;
}

export interface HawaiiTables {
  /** Booklet A annualized method: one regular withholding allowance. */
  allowance: Cents;
  /** Booklet A annualized method: the extra lump-sum allowance every employee gets. */
  lumpSum: Cents;
  schedule: Record<HawaiiFilingStatus, Bracket[]>;
  /** Temporary Disability Insurance: employee share, as a fraction of weekly wages, and its weekly cap. */
  tdiEmployeeRate: number;
  tdiWeeklyWageCap: Cents;
  /** Unemployment insurance taxable wage base; the rate is employer-specific (intake). */
  uiWageBase: Cents;
  /** Employment and Training assessment, applied to the same wage base. */
  etRate: number;
  /** State minimum wage, for the low-rate warning. */
  minimumWage: Cents;
}

export interface TaxYear {
  year: number;
  federal: FederalTables;
  hawaii: HawaiiTables;
  sources: string[];
}

const B = (from: number, base: number, rate: number): Bracket => ({ from: from * 100, base: Math.round(base * 100), rate });

/**
 * 2026. Federal brackets are the "Percentage Method Tables for Automated Payroll Systems"
 * in Publication 15-T (2026), annual amounts. Hawaii brackets are Appendix 2 of the
 * Department of Taxation's withholding tables for taxable years beginning after
 * December 31, 2025 (annualized method).
 */
export const TAX_2026: TaxYear = {
  year: 2026,
  federal: {
    step2UncheckedAdjustment: { married: 12_900_00, single: 8_600_00, head: 8_600_00 },
    standard: {
      married: [
        B(0, 0, 0),
        B(19_300, 0, 0.1),
        B(44_100, 2_480, 0.12),
        B(120_100, 11_600, 0.22),
        B(230_700, 35_932, 0.24),
        B(422_850, 82_048, 0.32),
        B(531_750, 116_896, 0.35),
        B(788_000, 206_583.5, 0.37),
      ],
      single: [
        B(0, 0, 0),
        B(7_500, 0, 0.1),
        B(19_900, 1_240, 0.12),
        B(57_900, 5_800, 0.22),
        B(113_200, 17_966, 0.24),
        B(209_275, 41_024, 0.32),
        B(263_725, 58_448, 0.35),
        B(648_100, 192_979.25, 0.37),
      ],
      head: [
        B(0, 0, 0),
        B(15_550, 0, 0.1),
        B(33_250, 1_770, 0.12),
        B(83_000, 7_740, 0.22),
        B(121_250, 16_155, 0.24),
        B(217_300, 39_207, 0.32),
        B(271_750, 56_631, 0.35),
        B(656_150, 191_171, 0.37),
      ],
    },
    step2Checked: {
      married: [
        B(0, 0, 0),
        B(16_100, 0, 0.1),
        B(28_500, 1_240, 0.12),
        B(66_500, 5_800, 0.22),
        B(121_800, 17_966, 0.24),
        B(217_875, 41_024, 0.32),
        B(272_325, 58_448, 0.35),
        B(400_450, 103_291.75, 0.37),
      ],
      single: [
        B(0, 0, 0),
        B(8_050, 0, 0.1),
        B(14_250, 620, 0.12),
        B(33_250, 2_900, 0.22),
        B(60_900, 8_983, 0.24),
        B(108_938, 20_512, 0.32),
        B(136_163, 29_224, 0.35),
        B(328_350, 96_489.63, 0.37),
      ],
      head: [
        B(0, 0, 0),
        B(12_075, 0, 0.1),
        B(20_925, 885, 0.12),
        B(45_800, 3_870, 0.22),
        B(64_925, 8_077.5, 0.24),
        B(112_950, 19_603.5, 0.32),
        B(140_175, 28_315.5, 0.35),
        B(332_375, 95_585.5, 0.37),
      ],
    },
    socialSecurityRate: 0.062,
    socialSecurityWageBase: 184_500_00,
    medicareRate: 0.0145,
    additionalMedicareRate: 0.009,
    additionalMedicareThreshold: 200_000_00,
    futaRate: 0.006,
    futaWageBase: 7_000_00,
  },
  hawaii: {
    allowance: 1_144_00,
    lumpSum: 4_350_00,
    schedule: {
      single: [
        B(0, 0, 0.014),
        B(9_600, 134, 0.032),
        B(14_400, 288, 0.055),
        B(19_200, 552, 0.064),
        B(24_000, 859, 0.068),
        B(36_000, 1_675, 0.072),
        B(48_000, 2_539, 0.076),
        B(125_000, 8_391, 0.079),
      ],
      married: [
        B(0, 0, 0.014),
        B(19_200, 269, 0.032),
        B(28_800, 576, 0.055),
        B(38_400, 1_104, 0.064),
        B(48_000, 1_718, 0.068),
        B(72_000, 3_350, 0.072),
        B(96_000, 5_078, 0.076),
        B(250_000, 16_782, 0.079),
      ],
    },
    tdiEmployeeRate: 0.005,
    tdiWeeklyWageCap: 1_500_21,
    uiWageBase: 64_500_00,
    etRate: 0.0001,
    minimumWage: 16_00,
  },
  sources: [
    "IRS Publication 15-T (2026), Percentage Method Tables for Automated Payroll Systems",
    "IRS Publication 15 (2026): Social Security wage base, Medicare, FUTA",
    "Hawaii Department of Taxation, Appendix 2: Income Tax Withholding Tables for Taxable Years Beginning After December 31, 2025",
    "Hawaii DLIR: 2026 TDI maximum weekly wage base and UI taxable wage base (confirm against the DLIR notice before the first 2026 pay run)",
    "HRS 387-2: minimum wage $16.00 from January 1, 2026",
  ],
};

export const TAX_YEARS: Record<number, TaxYear> = { 2026: TAX_2026 };

export const taxYearFor = (isoDate: string): TaxYear | undefined => TAX_YEARS[Number(isoDate.slice(0, 4))];

/** Tax on an annual amount from a bracket schedule: base for the bracket plus the rate on the excess. */
export function bracketTax(schedule: Bracket[], annual: Cents): Cents {
  if (annual <= 0) return 0;
  let b = schedule[0]!;
  for (const row of schedule) if (annual >= row.from) b = row;
  return Math.round(b.base + (annual - b.from) * b.rate);
}
