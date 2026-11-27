import { part120Enabled } from "./part-120/service";

/**
 * Programs are ongoing compliance desks an organization runs itself. Unlike products
 * (src/products), they have no engagement, quote, draft, or reviewer: the client's own
 * responsible official enters facts and signs.
 */
export interface ProgramDefinition {
  slug: string;
  /** Brand line, e.g. "Easier Compliance". */
  line: string;
  name: string;
  tagline: string;
  /** Who is responsible for the work, shown where products show the reviewer credential. */
  signedBy: string;
  status: "live" | "beta";
  href: (orgId: string) => string;
  enabled: () => boolean;
}

export const PROGRAMS: ProgramDefinition[] = [
  {
    slug: "part-120",
    line: "Easier Compliance",
    name: "Part 120 Compliance Desk",
    tagline: "Run an FAA drug and alcohol testing program: clearance before duty, random draws, event clocks, records, and a self-audit.",
    signedBy: "your own designated employer representative",
    status: "beta",
    href: (orgId) => `/p120/${orgId}`,
    enabled: part120Enabled,
  },
];

/** Programs switched on for this deployment. */
export const activePrograms = () => PROGRAMS.filter((p) => p.enabled());
