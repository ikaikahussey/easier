/** All amounts are integer cents internally. Forms report whole dollars. */
export type Cents = number;

export function parseAmount(raw: string | number | null | undefined): Cents {
  if (raw === null || raw === undefined) return 0;
  if (typeof raw === "number") return Math.round(raw * 100);
  let s = raw.trim();
  if (!s) return 0;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$,\s]/g, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`Invalid amount: "${raw}"`);
  const cents = Math.round(n * 100);
  return negative ? -cents : cents;
}

export const toDollars = (c: Cents): number => Math.round(c / 100);

export const sum = (values: Iterable<Cents>): Cents => {
  let t = 0;
  for (const v of values) t += v;
  return t;
};

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
export const formatUsd = (c: Cents): string => usd.format(toDollars(c));

const usdCents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
/** Dollars and cents, for small amounts such as hourly wages and pledge contributions. */
export const formatUsdCents = (c: Cents): string => usdCents.format(c / 100);

/** Split an amount across weights without losing cents; remainder goes to the largest share. */
export function allocate<K extends string>(amount: Cents, weights: Record<K, number>): Record<K, Cents> {
  const keys = Object.keys(weights) as K[];
  const total = keys.reduce((t, k) => t + weights[k], 0);
  if (total <= 0) throw new Error("Allocation weights must sum to a positive number");
  const out = {} as Record<K, Cents>;
  let assigned = 0;
  let largest = keys[0]!;
  for (const k of keys) {
    out[k] = Math.trunc((amount * weights[k]) / total);
    assigned += out[k];
    if (weights[k] > weights[largest]) largest = k;
  }
  out[largest] += amount - assigned;
  return out;
}
