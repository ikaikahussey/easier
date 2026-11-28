import { CONSENT_DOCUMENTS } from "@/core/consents";
import { launchBlockers, launchChecks, lineStatus, type LaunchCheck, type LineStatus } from "@/core/launch";
import type { ProductDefinition } from "@/core/product";
import { siteDocuments } from "@/core/site-terms";
import { PRODUCTS } from "@/products";
import { PROGRAMS, type ProgramDefinition } from "@/programs";
import { TERMS as PART_120_TERMS } from "@/programs/part-120/terms";

/** Whether a member of the public can start this product today. */
export const productStatus = (p: ProductDefinition): LineStatus => lineStatus({ slug: p.slug, needsPreparer: p.consents.length > 0 });
export const programStatus = (p: ProgramDefinition): LineStatus => lineStatus({ slug: p.slug, enabled: p.enabled() });

/** Legal documents whose version still says "draft": counsel has not signed off on them. */
export function draftDocuments(): string[] {
  const docs: [string, string][] = [
    ...Object.values(siteDocuments()).map((d): [string, string] => [d.title, d.version]),
    ...Object.values(CONSENT_DOCUMENTS).map((d): [string, string] => [d.title, d.version]),
    [PART_120_TERMS.title, PART_120_TERMS.version],
  ];
  return docs.filter(([, version]) => /draft/i.test(version)).map(([title]) => title);
}

/** The launch checklist for this deployment, as shown at /admin and enforced by the preflight for the environment checks. */
export function readiness(): { checks: LaunchCheck[]; blockers: LaunchCheck[] } {
  const openLines = [...PRODUCTS.map(productStatus), ...PROGRAMS.map(programStatus)].filter((s) => s.open).map((s) => s.slug);
  const checks = launchChecks(process.env, { openLines, draftDocuments: draftDocuments() });
  return { checks, blockers: launchBlockers(checks) };
}
