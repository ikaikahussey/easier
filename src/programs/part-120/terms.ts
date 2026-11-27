import { sha256 } from "@/core/crypto";

/**
 * Terms the employer accepts before using the Part 120 Compliance Desk. The acceptance
 * stores the version and a hash of the exact text shown, with the signer's name and title.
 * Changing any wording changes the hash, and every employer must accept again before the
 * desk will record anything further. Bump `version` with each revision.
 *
 * DRAFT TEXT: counsel must review this document before it is shown to a real customer.
 */
export const TERMS = {
  version: "2026-11-27-draft-1",
  title: "Part 120 Compliance Desk terms",
  paragraphs: [
    "Our role. easier.company provides this desk as a service agent under 49 CFR part 40. We are not your designated employer representative and cannot act as one (49 CFR 40.355).",
    "Your responsibility. You remain responsible for your drug and alcohol testing program and for meeting 14 CFR part 120 and 49 CFR part 40, including the actions of every service agent you use (49 CFR 40.11(b)). Using this desk does not transfer that responsibility to us.",
    "What the desk does. It records the facts you enter and applies fixed rules to them: clearance before duty, random selection, time limits after an event, reports that are due, minimum record retention, and the annual report. It makes no determinations. Decisions to test, to remove someone from duty, to return someone to duty, and to report to the FAA are yours.",
    "What the desk does not do. It does not collect specimens, verify results, or act as a medical review officer, substance abuse professional, collector, or breath alcohol technician. Nothing in it is legal or medical advice.",
    "Rule values. The rules reflect our reading of the regulations on the date shown in the desk. Regulations and the FAA's annual testing rates change. You agree to check the rule values against the current regulations and FAA notices, and to tell us if you find a difference.",
    "Your entries. What the desk shows depends on what you enter. You agree to enter only results verified by your medical review officer or confirmed by your breath alcohol technician, and to keep entries accurate and current.",
    "Records. The desk is an index of your records, not the records themselves. You must keep the original forms, letters, and reports in a secure location with controlled access for the periods the regulations require.",
    "Confidentiality. Each record is encrypted with a key unique to your organization. Only members of your organization can read it; our staff cannot. You decide who in your organization has an account, and you agree to limit accounts to people who may see testing information under 49 CFR part 40.",
    "Beta service. The desk is in beta. It may change, and it may be unavailable at times. Do not rely on it as your only reminder of a deadline.",
    "Limits. To the extent the law allows, our liability for this service is limited to the fees you paid for it in the twelve months before the claim, and we are not liable for penalties, enforcement action, or losses that result from your program's compliance or noncompliance.",
  ],
} as const;

/** Hash of the exact text an employer is shown. */
export const termsHash = (): string => sha256(`${TERMS.version}\n${TERMS.paragraphs.join("\n")}`);
