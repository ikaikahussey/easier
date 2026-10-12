import Link from "next/link";
import type { ReactNode } from "react";
import type { FieldSpec, FormSpec } from "@/core/fields";
import { formatUsd, formatUsdCents } from "@/core/money";
import { LABOR_PLEDGE, type PledgeTerms } from "@/core/pledge";
import type { Quote, ReviewSection } from "@/core/product";
import type { Finding } from "@/core/rules";
import type { Status } from "@/core/workflow";
import type { Actor } from "@/core/services/context";
import { logoutAction } from "@/app/actions";

/**
 * Page frame: a header and optional hero on the theme background, content on a sheet.
 * Every link and button here does something; nothing is decoration posing as a control.
 */
export function Shell({ actor, hero, children }: { actor?: Actor; hero?: ReactNode; children: ReactNode }) {
  const staff = actor && actor.role !== "client";
  return (
    <div className="min-h-screen">
      <header className="no-print mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-5">
        <Link href="/" className="display text-2xl no-underline! sm:text-3xl" aria-label="easier.company home">
          easier.company
        </Link>
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2" aria-label="Main">
          <Link href="/labor-pledge" className="nav-link">
            Labor Pledge
          </Link>
          {actor ? (
            <>
              <Link href={staff ? "/review" : "/app"} className="nav-link">
                {staff ? "Review queue" : "Your organizations"}
              </Link>
              <form action={logoutAction}>
                <button className="nav-link cursor-pointer" title={`Signed in as ${actor.email}`}>
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <Link href="/login" className={buttonClass("primary")}>
              Sign in
            </Link>
          )}
        </nav>
      </header>
      {hero}
      <main className="sheet mx-auto max-w-6xl px-4 py-8 sm:px-8">{children}</main>
      <footer className="no-print mx-auto flex max-w-6xl flex-wrap gap-x-6 gap-y-2 px-4 py-6">
        <Link href="/" className="nav-link">
          Home
        </Link>
        <Link href="/labor-pledge" className="nav-link">
          Labor Pledge
        </Link>
      </footer>
    </div>
  );
}

/** A page title on a sheet. */
export function PageTitle({ children, kicker }: { children: ReactNode; kicker?: ReactNode }) {
  return (
    <div className="mb-6">
      {kicker && <p className="mb-1 text-sm text-muted">{kicker}</p>}
      <h1 className="display text-3xl sm:text-4xl">{children}</h1>
    </div>
  );
}

export function Notice({ error, success }: { error?: string; success?: string }) {
  if (!error && !success) return null;
  return (
    <div
      role={error ? "alert" : "status"}
      className={`mb-6 border-l-8 px-4 py-3 text-sm font-bold ${
        error ? "border-danger bg-accent-soft text-danger" : "border-ok bg-accent-soft text-ink"
      }`}
    >
      {error ?? success}
    </div>
  );
}

const STATUS_STYLE: Record<Status, string> = {
  awaiting_documents: "border-warn text-warn",
  in_review: "border-accent text-accent",
  changes_requested: "border-danger text-danger",
  approved: "border-ok text-ok",
  delivered: "border-muted text-muted",
};

export function StatusBadge({ status, label }: { status: Status; label: string }) {
  return (
    <span className={`inline-block border-2 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${STATUS_STYLE[status]}`}>
      {label}
    </span>
  );
}

/** A titled section. The title bar is a heading, not a control. */
export function Card({ title, children, aside }: { title?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="panel mb-6 min-w-0">
      {(title || aside) && (
        <div className="panel-title flex items-baseline justify-between gap-4">
          {title && <h2 className="text-[13px] font-bold">{title}</h2>}
          {aside && <span className="text-[12px] font-normal normal-case tracking-normal">{aside}</span>}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function QuoteBox({ quote }: { quote: Quote }) {
  return (
    <dl className="text-sm">
      {quote.lines.map((l) => (
        <div key={l.label} className="flex justify-between gap-4 py-1">
          <dt className="text-muted">{l.label}</dt>
          <dd className="tabular-nums">{formatUsd(l.cents)}</dd>
        </div>
      ))}
      <div className="mt-1 flex justify-between border-t-2 border-ink pt-2 font-bold">
        <dt>{quote.tier}</dt>
        <dd className="tabular-nums">{formatUsd(quote.total)}</dd>
      </div>
      {quote.pledge && quote.pledge.contribution > 0 && <PledgeNote pledge={quote.pledge} />}
    </dl>
  );
}

export function PledgeNote({ pledge }: { pledge: PledgeTerms }) {
  return (
    <div className="mt-3 border-l-4 border-shadow bg-accent-soft px-3 py-2 text-xs">
      <p>
        Labor Pledge: this work would take a person about {pledge.hours} hours. At a living wage of{" "}
        {formatUsdCents(pledge.hourlyWage)} an hour, that is {formatUsdCents(pledge.laborValue)} of labor. From this fee,
        easier.company contributes {formatUsdCents(pledge.contribution)} ({Math.round(LABOR_PLEDGE.rate * 1000) / 10}%) to{" "}
        {LABOR_PLEDGE.recipient}.
      </p>
      <details className="mt-1">
        <summary className="cursor-pointer font-bold">How the hours are estimated</summary>
        <ul className="mt-1 space-y-0.5">
          {pledge.tasks.map((t) => (
            <li key={t.label} className="flex justify-between gap-3">
              <span>{t.label}</span>
              <span className="tabular-nums">{t.hours} h</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

const SEVERITY: Record<Finding["severity"], [string, string]> = {
  error: ["Must fix", "text-danger"],
  warning: ["Review", "text-warn"],
  info: ["Note", "text-accent"],
};

export function Findings({ findings }: { findings: Finding[] }) {
  if (!findings.length) return <p className="text-sm">No findings. All checks passed.</p>;
  return (
    <ul className="divide-y divide-line">
      {findings.map((f, i) => (
        <li key={i} className="py-2 text-sm">
          <span className={`mr-2 text-[11px] font-bold uppercase tracking-wider ${SEVERITY[f.severity][1]}`}>
            {SEVERITY[f.severity][0]}
          </span>
          {f.message}
          {f.ref && <span className="ml-2 text-xs text-muted">({f.ref})</span>}
        </li>
      ))}
    </ul>
  );
}

/** Renders any product's review sections; products never ship their own UI. */
export function Worksheet({ sections }: { sections: ReviewSection[] }) {
  return (
    <>
      {sections.map((s) => (
        <Card key={s.id} title={s.title}>
          {s.note && <p className="mb-3 text-sm text-muted">{s.note}</p>}
          {s.kind === "fields" ? (
            <dl className="grid gap-x-8 text-sm sm:grid-cols-2">
              {s.fields.map((f) => (
                <div key={f.label} className="flex justify-between gap-4 border-b border-line py-1.5">
                  <dt className="text-muted">
                    {f.label}
                    {f.ref && <span className="ml-1 text-xs">({f.ref})</span>}
                  </dt>
                  <dd className="text-right tabular-nums">{f.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table w-full text-sm">
                <thead>
                  <tr className="text-left">
                    {s.columns.map((c) => (
                      <th key={c.key} className={c.numeric ? "text-right" : ""}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {s.rows.map((r, i) => (
                    <tr key={i} className="align-top">
                      {s.columns.map((c) => (
                        <td key={c.key} className={c.numeric ? "text-right tabular-nums" : ""}>
                          {r[c.key]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {s.footer && (
                  <tfoot>
                    <tr className="font-bold">
                      {s.columns.map((c) => (
                        <td key={c.key} className={`border-t-2 border-ink ${c.numeric ? "text-right tabular-nums" : ""}`}>
                          {s.footer![c.key]}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </Card>
      ))}
    </>
  );
}

const input = "field w-full text-sm";

function Field({ f, name, values = {} }: { f: FieldSpec; name: string; values?: Record<string, string> }) {
  const v = values[name];
  const label = (
    <span className="mb-1 block text-sm font-bold">
      {f.label}
      {f.required && <span className="text-danger"> *</span>}
    </span>
  );
  switch (f.type) {
    case "textarea":
      return (
        <label className="block">
          {label}
          <textarea name={name} rows={3} className={input} required={f.required} defaultValue={v} />
        </label>
      );
    case "yesno":
      return (
        <fieldset className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-2">
          <legend className="sr-only">{f.label}</legend>
          <span className="max-w-xl text-sm">
            {f.label}
            {f.required && <span className="text-danger"> *</span>}
          </span>
          <span className="flex gap-4 text-sm">
            {["yes", "no"].map((opt) => (
              <label key={opt} className="flex items-center gap-1.5">
                <input type="radio" name={name} value={opt} required={f.required} defaultChecked={v === opt} /> {opt === "yes" ? "Yes" : "No"}
              </label>
            ))}
          </span>
        </fieldset>
      );
    case "checkbox":
      return (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name={name} defaultChecked={v === "on"} /> {f.label}
        </label>
      );
    case "select":
      return (
        <label className="block">
          {label}
          <select name={name} className={input} required={f.required} defaultValue={v ?? ""}>
            <option value="" disabled>
              Choose…
            </option>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      );
    case "list":
      return (
        <div>
          {label}
          <div className="space-y-3">
            {Array.from({ length: f.rows }, (_, i) => (
              <div key={i} className="grid gap-3 border border-line p-3 sm:grid-cols-2">
                {f.fields.map((sub) => (
                  <Field key={sub.name} f={{ ...sub, required: false }} name={`${name}.${i}.${sub.name}`} values={values} />
                ))}
              </div>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">Leave unused rows blank.</p>
        </div>
      );
    default: {
      const type = f.type === "money" || f.type === "number" || f.type === "percent" ? "number" : f.type;
      return (
        <label className="block">
          {label}
          <input
            name={name}
            type={type}
            step={f.type === "money" ? "0.01" : "any"}
            min={f.type === "percent" ? 0 : undefined}
            max={f.type === "percent" ? 100 : undefined}
            className={input}
            required={f.required}
            defaultValue={v}
          />
        </label>
      );
    }
  }
}

export function FormFields({ form, values }: { form: FormSpec; values?: Record<string, string> }) {
  return (
    <>
      {form.map((section) => (
        <Card key={section.title} title={section.title}>
          {section.help && <p className="mb-4 text-sm text-muted">{section.help}</p>}
          <div className="space-y-4">
            {section.fields.map((f) => (
              <Field key={f.name} f={f} name={f.name} values={values} />
            ))}
          </div>
        </Card>
      ))}
    </>
  );
}

/** Button styling, shared by <button> and links that act as buttons. */
export const buttonClass = (variant: "primary" | "quiet" | "danger" = "quiet") =>
  `btn ${variant === "primary" ? "btn-primary" : variant === "danger" ? "btn-danger" : ""}`;

export const Button = ({ children, variant = "primary", ...rest }: { children: ReactNode; variant?: "primary" | "quiet" | "danger" } & React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button {...rest} className={`${buttonClass(variant)} ${rest.className ?? ""}`}>
    {children}
  </button>
);

export const inputClass = input;
