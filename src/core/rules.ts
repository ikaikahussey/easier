export type Severity = "error" | "warning" | "info";

export interface Finding {
  ruleId: string;
  severity: Severity;
  message: string;
  /** Form or standard reference, e.g. "Form 990 Part IX". */
  ref?: string;
  /** What the finding is about (account id, field name), for linking in the UI. */
  subject?: string;
}

type Hit = string | { message: string; subject?: string };

export interface Rule<C> {
  id: string;
  severity: Severity;
  description: string;
  ref?: string;
  /** Return nothing when the check passes, or one entry per problem found. */
  check: (ctx: C) => Hit[] | Hit | undefined | void;
}

export function runRules<C>(rules: readonly Rule<C>[], ctx: C): Finding[] {
  const findings: Finding[] = [];
  for (const rule of rules) {
    let hits: Hit[];
    try {
      const r = rule.check(ctx);
      hits = r === undefined ? [] : Array.isArray(r) ? r : [r];
    } catch (e) {
      hits = [`Check could not run: ${(e as Error).message}`];
    }
    for (const h of hits) {
      const { message, subject } = typeof h === "string" ? { message: h, subject: undefined } : h;
      findings.push({ ruleId: rule.id, severity: rule.severity, message, ref: rule.ref, subject });
    }
  }
  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity]);
}

export const blocking = (findings: Finding[]) => findings.filter((f) => f.severity === "error");

/** Adapt rules written for one context to another (lets products reuse shared rule sets). */
export function adaptRules<C, D>(rules: readonly Rule<C>[], select: (d: D) => C): Rule<D>[] {
  return rules.map((r) => ({ ...r, check: (d: D) => r.check(select(d)) }));
}
