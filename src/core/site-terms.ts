import { sha256 } from "./crypto";

/**
 * Site-wide documents every account accepts: the terms of service and the privacy policy.
 * They sit above the per-engagement documents (src/core/consents.ts) and the Part 120 terms
 * (src/programs/part-120/terms.ts), which govern the work itself.
 *
 * An acceptance stores the version and a hash of the exact text shown. Changing any wording
 * changes the hash; bump `version` with each revision. An account whose acceptance does not
 * match the current text must accept again before it can add an organization.
 *
 * DRAFT TEXT: counsel must review both documents. Not yet covered and left for counsel:
 * governing law and venue, dispute resolution, and the operator's legal name and address.
 */

export type SiteDocumentId = "terms" | "privacy";

export interface SiteDocument {
  id: SiteDocumentId;
  version: string;
  title: string;
  href: string;
  sections: { heading: string; paragraphs: string[] }[];
}

/** Where questions, privacy requests, and notices go. Shown in both documents. */
export const configuredContact = (): string | undefined => process.env.CONTACT_EMAIL?.trim() || undefined;
const contact = () => configuredContact() ?? "[contact email not configured]";

export const siteDocuments = (): Record<SiteDocumentId, SiteDocument> => ({
  terms: {
    id: "terms",
    version: "2026-11-27-draft-1",
    title: "Terms of service",
    href: "/terms",
    sections: [
      {
        heading: "Who we are",
        paragraphs: [
          "easier.company provides business services prepared by software and, where a license is required, reviewed and signed by a licensed professional. These terms cover your account and your use of the site. The work itself is governed by the document you accept when you start it: an engagement letter for tax and accounting work, or the program terms for a compliance desk. If one of those documents conflicts with these terms, that document controls for that work.",
        ],
      },
      {
        heading: "Your account",
        paragraphs: [
          "You must be 18 or older and authorized to act for each organization you add. Keep your password private and tell us promptly if you believe someone else has used your account. You are responsible for activity under your account.",
          "We confirm your email address before you can add an organization. We may suspend an account that we reasonably believe is being used unlawfully, to attack the service, or on behalf of an organization the account holder does not represent.",
        ],
      },
      {
        heading: "What the service is and is not",
        paragraphs: [
          "Software, including artificial intelligence models, prepares drafts. A tax return or other deliverable that requires a licensed signer is released only after the professional named in your engagement letter has reviewed and signed it. A service line that has no named professional does not accept engagements.",
          "Nothing on the site is legal advice. Compliance desks record what you enter and apply fixed rules; decisions and regulatory responsibility stay with you.",
          "A line marked beta may change or be unavailable at times.",
        ],
      },
      {
        heading: "Prices and payment",
        paragraphs: [
          "Prices are flat and shown before you start. Your quote states the fee for the work. We invoice the fee; it does not change with the time the work takes. Additional services are agreed in writing before they begin.",
        ],
      },
      {
        heading: "Your information",
        paragraphs: [
          "You keep ownership of what you upload and enter. You give us permission to use it to perform the work you ask for, as described in the privacy policy. You are responsible for its accuracy and for having the right to share it with us.",
        ],
      },
      {
        heading: "Acceptable use",
        paragraphs: [
          "Do not attempt to access another organization's data, interfere with the service, upload malicious files, or use automated means to create accounts or submit forms.",
        ],
      },
      {
        heading: "Ending the relationship",
        paragraphs: [
          `You may stop using the service at any time and may ask us to close your account by writing to ${contact()}. Records of completed work are kept for the period stated in the document that governs that work.`,
        ],
      },
      {
        heading: "Disclaimers and limits",
        paragraphs: [
          "Except as stated in the document that governs a piece of work, the site is provided as is. To the extent the law allows, our total liability arising from your use of the site is limited to the fees you paid us in the twelve months before the claim, and we are not liable for indirect or consequential losses.",
        ],
      },
      {
        heading: "Changes",
        paragraphs: [
          "If we change these terms we will post the new version here with its version identifier and ask you to accept it before you add another organization. Work already under way continues under the documents accepted for it.",
          `Questions: ${contact()}.`,
        ],
      },
    ],
  },
  privacy: {
    id: "privacy",
    version: "2026-11-27-draft-1",
    title: "Privacy policy",
    href: "/privacy",
    sections: [
      {
        heading: "What we collect",
        paragraphs: [
          "Account information: your name, email address, and a one-way hash of your password. We never store the password itself.",
          "Organization and engagement information: what you enter and upload to have work done, such as trial balances, answers to intake questions, and the names and compensation of officers and directors. For a compliance desk, the personnel and testing records you choose to enter.",
          "Records of use: an audit trail of actions on each engagement, including each time our staff view it; sign-in attempts by email address; and a one-way hash of the network address behind sign-up, sign-in, and waitlist requests, kept for one day to limit abuse.",
          "If you join a waitlist, your email address and the category you select.",
          "We set one cookie, which keeps you signed in. We do not use advertising or analytics trackers.",
        ],
      },
      {
        heading: "How we use it",
        paragraphs: [
          "To perform the work you ask for, to operate and secure the service, to send you sign-in links and messages about your work, and to keep the records a preparer is required to keep. We do not sell personal information and do not use your information to advertise to you.",
          "Tax return information is used and disclosed only as the Internal Revenue Code section 7216 consent you sign for that engagement allows.",
        ],
      },
      {
        heading: "Who can see it",
        paragraphs: [
          "Members of your organization. The licensed professional assigned to an engagement, for that engagement only; every staff view is written to an audit trail you can read. Our staff have no access to compliance desk records.",
          "Service providers that process information for us: a cloud host and database provider that store the encrypted records; an artificial intelligence provider, which receives the data of the engagement being drafted and nothing from any other engagement; and an email provider, which receives your email address and the message we send.",
          "We disclose information when the law requires it.",
        ],
      },
      {
        heading: "How we protect it",
        paragraphs: [
          "Each organization's records are encrypted with a key unique to that organization, and the database refuses queries for an organization the signed-in user does not belong to. Pages that show client data are not cached.",
          "No system is perfectly secure. If we learn of a breach affecting your information we will notify you as the law requires.",
        ],
      },
      {
        heading: "How long we keep it",
        paragraphs: [
          "Engagement records are kept for at least three years after the engagement ends, as your engagement letter states. Compliance desk records are kept while you use the desk. Account information is kept while your account is open. Waitlist entries are kept until we have contacted you or you ask us to remove them.",
        ],
      },
      {
        heading: "Your choices",
        paragraphs: [
          `You may ask for a copy of your information, ask us to correct it, or ask us to delete it, by writing to ${contact()}. We will delete what we are not required to keep. Destroying an organization's encryption key makes its records unreadable, and we can do that at the organization's request once any required retention period has passed.`,
        ],
      },
      {
        heading: "Changes and contact",
        paragraphs: [`We will post any change here with a new version identifier. Questions and requests: ${contact()}.`],
      },
    ],
  },
});

export const SITE_DOCUMENT_IDS: SiteDocumentId[] = ["terms", "privacy"];

/** One version string and one hash cover both documents, so a change to either asks for acceptance again. */
export function siteTerms(): { version: string; hash: string } {
  const docs = siteDocuments();
  const text = SITE_DOCUMENT_IDS.map((id) => {
    const d = docs[id];
    return [d.title, d.version, ...d.sections.flatMap((s) => [s.heading, ...s.paragraphs])].join("\n");
  }).join("\n\n");
  return { version: SITE_DOCUMENT_IDS.map((id) => `${id}:${docs[id].version}`).join(" "), hash: sha256(text) };
}
