/**
 * One engagement lifecycle shared by every product:
 * client supplies documents → AI drafts → licensed reviewer approves → delivered.
 */
export const STATUSES = {
  awaiting_documents: { label: "Awaiting documents", owner: "client" },
  in_review: { label: "In review", owner: "reviewer" },
  changes_requested: { label: "Changes requested", owner: "client" },
  approved: { label: "Approved", owner: "reviewer" },
  delivered: { label: "Delivered", owner: "none" },
} as const;

export type Status = keyof typeof STATUSES;
export type Role = "client" | "reviewer" | "admin";
export type Action = "submit" | "request_changes" | "approve" | "reopen" | "deliver";

interface Transition {
  from: Status[];
  to: Status;
  roles: Role[];
  /** Approval is blocked while error-severity findings remain. */
  requiresNoErrors?: boolean;
  requiresNote?: boolean;
}

export const TRANSITIONS: Record<Action, Transition> = {
  submit: { from: ["awaiting_documents", "changes_requested"], to: "in_review", roles: ["client", "reviewer", "admin"] },
  request_changes: { from: ["in_review"], to: "changes_requested", roles: ["reviewer", "admin"], requiresNote: true },
  approve: { from: ["in_review"], to: "approved", roles: ["reviewer", "admin"], requiresNoErrors: true },
  reopen: { from: ["approved"], to: "in_review", roles: ["reviewer", "admin"] },
  deliver: { from: ["approved"], to: "delivered", roles: ["reviewer", "admin"] },
};

export class WorkflowError extends Error {}

export function nextStatus(
  current: Status,
  action: Action,
  ctx: { role: Role; errorCount: number; note?: string },
): Status {
  const t = TRANSITIONS[action];
  if (!t.from.includes(current)) throw new WorkflowError(`Cannot ${action} from "${STATUSES[current].label}"`);
  if (!t.roles.includes(ctx.role)) throw new WorkflowError(`Role "${ctx.role}" cannot ${action}`);
  if (t.requiresNoErrors && ctx.errorCount > 0)
    throw new WorkflowError(`Resolve ${ctx.errorCount} blocking finding(s) before approval`);
  if (t.requiresNote && !ctx.note?.trim()) throw new WorkflowError(`A note is required to ${action}`);
  return t.to;
}

export const availableActions = (current: Status, role: Role): Action[] =>
  (Object.keys(TRANSITIONS) as Action[]).filter(
    (a) => TRANSITIONS[a].from.includes(current) && TRANSITIONS[a].roles.includes(role),
  );
