/**
 * One engagement lifecycle shared by every product:
 * client supplies documents → AI drafts → licensed reviewer approves → delivered.
 * Products that are filed with an agency continue: filed → accepted or rejected.
 */
export const STATUSES = {
  awaiting_documents: { label: "Awaiting documents", owner: "client" },
  in_review: { label: "In review", owner: "reviewer" },
  changes_requested: { label: "Changes requested", owner: "client" },
  approved: { label: "Approved", owner: "reviewer" },
  delivered: { label: "Delivered", owner: "none" },
  filed: { label: "Filed", owner: "reviewer" },
  accepted: { label: "Accepted by IRS", owner: "none" },
  rejected: { label: "Rejected by IRS", owner: "reviewer" },
} as const;

export type Status = keyof typeof STATUSES;
export type Role = "client" | "reviewer" | "admin";
export type Action =
  | "submit"
  | "request_changes"
  | "approve"
  | "reopen"
  | "deliver"
  | "record_filing"
  | "record_acceptance"
  | "record_rejection";

interface Transition {
  from: Status[];
  to: Status;
  roles: Role[];
  /** Approval is blocked while error-severity findings remain. */
  requiresNoErrors?: boolean;
  requiresNote?: boolean;
  /** Available only for products filed with an agency. */
  filingOnly?: boolean;
}

export const TRANSITIONS: Record<Action, Transition> = {
  submit: { from: ["awaiting_documents", "changes_requested"], to: "in_review", roles: ["client", "reviewer", "admin"] },
  request_changes: { from: ["in_review"], to: "changes_requested", roles: ["reviewer", "admin"], requiresNote: true },
  approve: { from: ["in_review"], to: "approved", roles: ["reviewer", "admin"], requiresNoErrors: true },
  reopen: { from: ["approved", "rejected"], to: "in_review", roles: ["reviewer", "admin"] },
  deliver: { from: ["approved"], to: "delivered", roles: ["reviewer", "admin"] },
  record_filing: { from: ["delivered", "rejected"], to: "filed", roles: ["reviewer", "admin"], filingOnly: true },
  record_acceptance: { from: ["filed"], to: "accepted", roles: ["reviewer", "admin"], filingOnly: true },
  record_rejection: { from: ["filed"], to: "rejected", roles: ["reviewer", "admin"], requiresNote: true, filingOnly: true },
};

/** Statuses after approval: the work is signed and no longer edited. */
export const SIGNED: Status[] = ["approved", "delivered", "filed", "accepted", "rejected"];

export class WorkflowError extends Error {}

export function nextStatus(
  current: Status,
  action: Action,
  ctx: { role: Role; errorCount: number; note?: string; filing?: boolean },
): Status {
  const t = TRANSITIONS[action];
  if (!t) throw new WorkflowError(`Unknown action "${action}"`);
  if (t.filingOnly && !ctx.filing) throw new WorkflowError(`This product is not filed with an agency`);
  if (!t.from.includes(current)) throw new WorkflowError(`Cannot ${action.replace(/_/g, " ")} from "${STATUSES[current].label}"`);
  if (!t.roles.includes(ctx.role)) throw new WorkflowError(`Role "${ctx.role}" cannot ${action.replace(/_/g, " ")}`);
  if (t.requiresNoErrors && ctx.errorCount > 0)
    throw new WorkflowError(`Resolve ${ctx.errorCount} blocking finding(s) before approval`);
  if (t.requiresNote && !ctx.note?.trim()) throw new WorkflowError(`A note is required to ${action.replace(/_/g, " ")}`);
  return t.to;
}

export const availableActions = (current: Status, role: Role, opts: { filing?: boolean } = {}): Action[] =>
  (Object.keys(TRANSITIONS) as Action[]).filter(
    (a) =>
      TRANSITIONS[a].from.includes(current) && TRANSITIONS[a].roles.includes(role) && (!TRANSITIONS[a].filingOnly || opts.filing),
  );
