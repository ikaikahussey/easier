import { z } from "zod";
import type { OrgProfile, PriorYear } from "../product";

/** Public nonprofit data source used to prefill profiles and prior-year figures. */
export interface NonprofitRegistry {
  lookup(ein: string): Promise<{ profile: Partial<OrgProfile>; filings: PriorYear[] } | undefined>;
}

const response = z.object({
  organization: z
    .object({
      name: z.string().optional(),
      city: z.string().nullish(),
      state: z.string().nullish(),
      subsection_code: z.number().nullish(),
    })
    .passthrough(),
  filings_with_data: z
    .array(
      z
        .object({
          tax_prd_yr: z.number(),
          totrevenue: z.number().nullish(),
          totfuncexpns: z.number().nullish(),
          totassetsend: z.number().nullish(),
        })
        .passthrough(),
    )
    .default([]),
});

export const normalizeEin = (ein: string) => {
  const digits = ein.replace(/\D/g, "");
  return digits.length === 9 ? `${digits.slice(0, 2)}-${digits.slice(2)}` : undefined;
};

const cents = (d: number | null | undefined) => (d === null || d === undefined ? undefined : Math.round(d * 100));

/** ProPublica Nonprofit Explorer API (IRS e-file data). */
export function propublicaRegistry(fetchImpl: typeof fetch = fetch): NonprofitRegistry {
  return {
    async lookup(ein) {
      const id = ein.replace(/\D/g, "");
      if (id.length !== 9) return undefined;
      try {
        const res = await fetchImpl(`https://projects.propublica.org/nonprofits/api/v2/organizations/${id}.json`, {
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return undefined;
        const data = response.parse(await res.json());
        const o = data.organization;
        return {
          profile: {
            name: o.name,
            city: o.city ?? undefined,
            state: o.state ?? undefined,
            subsection: o.subsection_code ? `501(c)(${o.subsection_code})` : undefined,
          },
          filings: data.filings_with_data
            .map((f) => ({
              year: f.tax_prd_yr,
              totalRevenue: cents(f.totrevenue),
              totalExpenses: cents(f.totfuncexpns),
              totalAssets: cents(f.totassetsend),
            }))
            .sort((a, b) => b.year - a.year),
        };
      } catch {
        return undefined;
      }
    },
  };
}
