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

export function Shell({ actor, children }: { actor?: Actor; children: ReactNode }) {
  const staff = actor && actor.role !== "client";
  return (
    <div className="min-h-screen">
      <header className="no-print border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <Link href="/" className="font-serif text-xl font-semibold tracking-tight">
            Plainfirm
          </Link>
          <nav className="flex items-center gap-5 text-sm">
            {actor ? (
              <>
                <Link href={staff ? "/review" : "/app"} className="hover:text-accent">
                  {staff ? "Review queue" : "Your organizations"}
                </Link>
                <span className="hidden text-muted sm:inline">{actor.email}</span>
                <form action={logoutAction}>
                  <button className="text-muted hover:text-ink">Sign out</button>
                </form>
              </>
            ) : (
              <Link href="/login" className="rounded-md bg-accent px-3 py-1.5 text-white">
                Sign in
              </Link>
            )}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      <footer className="no-print border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap gap-5 px-4 py-6 text-sm text-muted">
          <span>Plainfirm</span>
          <Link href="/labor-pledge" className="hover:text-accent">
            The Labor Pledge
          </Link>
        </div>
      </footer>
    </div>
  );
}

export function Notice({ error, success }: { error?: string; success?: string }) {
  if (!error && !success) return null;
  return (
    <div
      role={error ? "alert" : "status"}
      className={`mb-6 rounded-md border px-4 py-3 text-sm ${
        error ? "border-danger/30 bg-red-50 text-danger" : "border-accent/30 bg-accent-soft text-accent"
      }`}
    >
      {error ?? success}
    </div>
  );
}

const STATUS_STYLE: Record<Status, string> = {
  awaiting_documents: "bg-amber-50 text-warn",
  in_review: "bg-blue-50 text-blue-800",
  changes_requested: "bg-red-50 text-danger",
  approved: "bg-accent-soft text-accent",
  delivered: "bg-stone-100 text-muted",
};

export function StatusBadge({ status, label }: { status: Status; label: string }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}>{label}</span>;
}

export function Card({ title, children, aside }: { title?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="mb-6 rounded-lg border border-line bg-white p-5">
      {(title || aside) && (
        <div className="mb-3 flex items-baseline justify-between gap-4">
          {title && <h2 className="text-lg font-semibold">{title}</h2>}
          {aside}
        </div>
      )}
      {children}
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
      <div className="mt-1 flex justify-between border-t border-line pt-2 font-semibold">
        <dt>{quote.tier}</dt>
        <dd className="tabular-nums">{formatUsd(quote.total)}</dd>
      </div>
      {quote.pledge && quote.pledge.contribution > 0 && <PledgeNote pledge={quote.pledge} />}
    </dl>
  );
}

export function PledgeNote({ pledge }: { pledge: PledgeTerms }) {
  return (
    <div className="mt-3 rounded-md bg-accent-soft px-3 py-2 text-xs text-accent">
      <p>
        Labor Pledge: this work would take a person about {pledge.hours} hours. At a living wage of{" "}
        {formatUsdCents(pledge.hourlyWage)} an hour, that is {formatUsdCents(pledge.laborValue)} of labor. From this fee,
        Plainfirm contributes {formatUsdCents(pledge.contribution)} ({Math.round(LABOR_PLEDGE.rate * 1000) / 10}%) to{" "}
        {LABOR_PLEDGE.recipient}.
      </p>
      <details className="mt-1">
        <summary className="cursor-pointer">How the hours are estimated</summary>
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
  error: ["Must fix", "border-l-danger"],
  warning: ["Review", "border-l-warn"],
  info: ["Note", "border-l-line"],
};

export function Findings({ findings }: { findings: Finding[] }) {
  if (!findings.length) return <p className="text-sm text-muted">No findings. All checks passed.</p>;
  return (
    <ul className="space-y-2">
      {findings.map((f, i) => (
        <li key={i} className={`border-l-4 bg-paper px-3 py-2 text-sm ${SEVERITY[f.severity][1]}`}>
          <span className="mr-2 text-xs font-semibold uppercase tracking-wide text-muted">{SEVERITY[f.severity][0]}</span>
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
            <dl className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
              {s.fields.map((f) => (
                <div key={f.label} className="flex justify-between gap-4 border-b border-line/60 py-1.5">
                  <dt className="text-muted">
                    {f.label}
                    {f.ref && <span className="ml-1 text-xs">· {f.ref}</span>}
                  </dt>
                  <dd className="text-right tabular-nums">{f.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                    {s.columns.map((c) => (
                      <th key={c.key} className={`py-2 pr-4 font-medium ${c.numeric ? "text-right" : ""}`}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {s.rows.map((r, i) => (
                    <tr key={i} className="border-b border-line/60 align-top">
                      {s.columns.map((c) => (
                        <td key={c.key} className={`py-1.5 pr-4 ${c.numeric ? "text-right tabular-nums" : ""}`}>
                          {r[c.key]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {s.footer && (
                  <tfoot>
                    <tr className="font-semibold">
                      {s.columns.map((c) => (
                        <td key={c.key} className={`py-2 pr-4 ${c.numeric ? "text-right tabular-nums" : ""}`}>
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

const input = "w-full rounded-md border border-line bg-white px-3 py-2 text-sm focus:border-accent focus:outline-none";

function Field({ f, name, values = {} }: { f: FieldSpec; name: string; values?: Record<string, string> }) {
  const v = values[name];
  const label = (
    <span className="mb-1 block text-sm font-medium">
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
        <fieldset className="flex flex-wrap items-center justify-between gap-3 border-b border-line/60 py-2">
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
              <div key={i} className="grid gap-3 rounded-md border border-line/70 p-3 sm:grid-cols-2">
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

export const Button = ({ children, variant = "primary", ...rest }: { children: ReactNode; variant?: "primary" | "quiet" | "danger" } & React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    {...rest}
    className={`rounded-md px-4 py-2 text-sm font-medium disabled:opacity-40 ${
      variant === "primary"
        ? "bg-accent text-white hover:bg-accent/90"
        : variant === "danger"
          ? "border border-danger/40 text-danger hover:bg-red-50"
          : "border border-line bg-white hover:bg-paper"
    } ${rest.className ?? ""}`}
  >
    {children}
  </button>
);

export const inputClass = input;
