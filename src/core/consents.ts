import { sha256 } from "./crypto";

/**
 * Documents a client accepts before work begins. Each acceptance records the document
 * id, version, and a hash of the exact text shown, so the audit trail proves what was
 * agreed to. Changing any wording changes the hash; bump `version` with each revision so
 * earlier acceptances no longer satisfy the gate.
 *
 * DRAFT TEXT: counsel must review both documents before they are shown to a real client.
 */

export type ConsentId = "engagement_letter" | "irc_7216";

export interface ConsentContext {
  orgName: string;
  productName: string;
  period: string;
  /** The licensed professional who signs the work, e.g. "Jane Doe, EA". */
  preparer: string;
  /** True when the work is a return filed with the IRS. */
  filed: boolean;
}

export interface ConsentDocument {
  id: ConsentId;
  version: string;
  title: string;
  /** One line shown above the full text. */
  summary: string;
  body: (c: ConsentContext) => string[];
}

/** Who signs returns during the pilot. Set PREPARER_OF_RECORD before inviting clients. */
export const preparerOfRecord = () => process.env.PREPARER_OF_RECORD?.trim() || "the licensed preparer named on your return";

export const CONSENT_DOCUMENTS: Record<ConsentId, ConsentDocument> = {
  engagement_letter: {
    id: "engagement_letter",
    version: "2026-10-pilot-draft-1",
    title: "Engagement letter",
    summary: "What we will prepare, what you are responsible for, and how the work is signed.",
    body: (c) => {
      const work = c.filed ? "the return" : "the work";
      return [
        `This letter confirms the terms under which ${c.preparer} (the "preparer") will prepare ${c.productName} for ${c.orgName} (the "organization") for the period ending ${c.period}, using the easier.company platform.`,
        `Scope. The preparer will prepare ${work} from the trial balance, answers, and other information the organization provides. The preparer will not audit, review, or otherwise verify that information. The engagement does not include an audit, review, or compilation of financial statements, or any schedule or form the platform identifies as not prepared.`,
        `How the work is done. Software, including artificial intelligence models, prepares a draft. The preparer reviews the draft, may request changes, and signs ${work} only after resolving every check the platform marks as must-fix.`,
        c.filed
          ? `The organization's responsibilities. The organization is responsible for the accuracy and completeness of the information it provides, for keeping the records that support the return, and for reviewing the return before an authorized officer signs Form 8879-TE. The return is filed only after that signature.`
          : `The organization's responsibilities. The organization is responsible for the accuracy and completeness of the information it provides and for keeping the records that support the work.`,
        `Fee. The organization will pay the flat fee shown on its quote. The fee does not change with the time the work takes. Additional services are agreed in writing before they begin.`,
        `Deadlines. The organization must provide complete information early enough for ${work} to be prepared and reviewed by its due date. The preparer is not responsible for penalties resulting from information provided late or incomplete.`,
        `Confidentiality. Client records are encrypted with a key unique to the organization and are accessible only to the organization's members and the reviewer assigned to this engagement.${c.filed ? " Use and disclosure of tax return information is governed by the separate consent the organization signs." : ""}`,
        `Term. This engagement ends when ${c.filed ? "the return is filed and accepted" : "the work is delivered"}, or when either party ends it in writing. Records are retained for at least three years after the engagement ends.`,
      ];
    },
  },
  irc_7216: {
    id: "irc_7216",
    version: "2026-10-pilot-draft-1",
    title: "Consent to use and disclose tax return information",
    summary: "Federal law (26 U.S.C. 7216) requires your consent before your return information is shared with the providers below.",
    body: (c) => [
      `Federal law requires this consent form to be provided to you. Unless authorized by law, we cannot disclose your tax return information to third parties for purposes other than the preparation and filing of your tax return without your consent.`,
      `Taxpayer: ${c.orgName}. Tax return preparer: ${c.preparer}. Return: ${c.productName} for the period ending ${c.period}.`,
      `Information covered: all information the organization provides for this return, including its trial balance, answers to the intake questions, and uploaded documents, and the draft and final return prepared from them.`,
      `Recipients and purpose: (1) easier.company, which operates the software used to prepare the return; and (2) Anthropic, PBC, which provides the artificial intelligence models that draft account classifications and narrative text. Each receives the information only to prepare this return. Neither may use it for any other purpose, including marketing or model training. Information sent to these providers may be processed outside the United States.`,
      `Duration: this consent is effective until the return is filed and accepted, or for one year from the date signed, whichever comes first.`,
      `If you believe your tax return information has been disclosed or used improperly in a manner unauthorized by law or without your permission, you may contact the Treasury Inspector General for Tax Administration (TIGTA) by telephone at 1-800-366-4484, or by email at complaints@tigta.treas.gov.`,
    ],
  },
};

export const renderConsent = (id: ConsentId, c: ConsentContext) => CONSENT_DOCUMENTS[id].body(c);

/** Hash of the exact text shown, recorded with each acceptance. */
export const consentHash = (id: ConsentId, c: ConsentContext) =>
  sha256([CONSENT_DOCUMENTS[id].title, ...renderConsent(id, c)].join("\n"));

export interface ConsentAcceptance {
  document: ConsentId;
  version: string;
  sha256: string;
  signerName: string;
  signerTitle: string;
  preparer: string;
}

export const isConsentId = (v: string): v is ConsentId => v in CONSENT_DOCUMENTS;
