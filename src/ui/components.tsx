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

/** Decorative minimize / maximize / close glyphs. */
export function TitleButtons() {
  return (
    <span className="titlebar-buttons" aria-hidden="true">
      <span className="raised">_</span>
      <span className="raised">□</span>
      <span className="raised ml-0.5">×</span>
    </span>
  );
}

/** A small brand mark drawn in CSS: a beveled tile with a check. */
export function Mark({ size = 16 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="raised inline-grid place-items-center font-bold text-accent"
      style={{ width: size, height: size, fontSize: size * 0.7, lineHeight: 1 }}
    >
      ✓
    </span>
  );
}

/** The whole site is one application window on the desktop. */
export function Shell({ actor, children }: { actor?: Actor; children: ReactNode }) {
  const staff = actor && actor.role !== "client";
  return (
    <div className="min-h-screen p-2 sm:p-6">
      <div className="raised mx-auto max-w-6xl p-[3px]">
        <header className="no-print">
          <div className="titlebar">
            <span className="flex items-center gap-2">
              <Mark />
              easier.company
            </span>
            <TitleButtons />
          </div>
          <nav className="flex flex-wrap items-center gap-1 border-b border-line px-1 py-1 text-[13px]" aria-label="Main">
            <Link href="/" className="menu-item">
              Home
            </Link>
            <Link href="/labor-pledge" className="menu-item">
              Labor Pledge
            </Link>
            {actor ? (
              <>
                <Link href={staff ? "/review" : "/app"} className="menu-item">
                  {staff ? "Review queue" : "Organizations"}
                </Link>
                <span className="ml-auto hidden px-2 text-muted sm:inline">{actor.email}</span>
                <form action={logoutAction} className="sm:ml-0 ml-auto">
                  <button className="menu-item">Sign out</button>
                </form>
              </>
            ) : (
              <Link href="/login" className="menu-item ml-auto">
                Sign in
              </Link>
            )}
          </nav>
        </header>
        <main className="px-3 py-5 sm:px-6">{children}</main>
        <footer className="no-print flex gap-[3px] pt-[3px] text-[12px]">
          <span className="sunken flex-1 px-2 py-1">Ready</span>
          <Link href="/labor-pledge" className="sunken px-2 py-1 text-ink! no-underline hover:underline">
            Labor Pledge
          </Link>
          <span className="sunken hidden px-2 py-1 sm:inline">easier.company</span>
        </footer>
      </div>
    </div>
  );
}

/** Message box: a stop icon for errors, an information icon otherwise. */
export function Notice({ error, success }: { error?: string; success?: string }) {
  if (!error && !success) return null;
  return (
    <div role={error ? "alert" : "status"} className="raised mb-5 flex items-start gap-3 p-3 text-sm">
      <span
        aria-hidden="true"
        className={`grid h-7 w-7 shrink-0 place-items-center rounded-full! font-bold text-white ${
          error ? "bg-danger" : "bg-accent"
        }`}
      >
        {error ? "×" : "i"}
      </span>
      <p className="pt-1">{error ?? success}</p>
    </div>
  );
}

const STATUS_DOT: Record<Status, string> = {
  awaiting_documents: "bg-[#ffff00]",
  in_review: "bg-[#00ffff]",
  changes_requested: "bg-[#ff0000]",
  approved: "bg-[#00ff00]",
  delivered: "bg-[#808080]",
};

export function StatusBadge({ status, label }: { status: Status; label: string }) {
  return (
    <span className="sunken inline-flex items-center gap-1.5 bg-white px-2 py-0.5 text-xs text-ink">
      <span aria-hidden="true" className={`inline-block h-2 w-2 border border-black ${STATUS_DOT[status]}`} />
      {label}
    </span>
  );
}

/** A group box: the 1990s dialog's way of grouping related controls. */
export function Card({ title, children, aside }: { title?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <fieldset className="groupbox mb-5 min-w-0">
      {title && <legend>{title}</legend>}
      {aside && <div className="-mt-1 mb-2 flex justify-end">{aside}</div>}
      {children}
    </fieldset>
  );
}

/** A standalone window, used for featured content. */
export function Window({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`raised p-[3px] ${className}`}>
      <div className="titlebar">
        <span>{title}</span>
        <TitleButtons />
      </div>
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
      <hr className="etched my-1" />
      <div className="flex justify-between pt-1 font-bold">
        <dt>{quote.tier}</dt>
        <dd className="tabular-nums">{formatUsd(quote.total)}</dd>
      </div>
      {quote.pledge && quote.pledge.contribution > 0 && <PledgeNote pledge={quote.pledge} />}
    </dl>
  );
}

/** Tooltip-yellow note on every quote. */
export function PledgeNote({ pledge }: { pledge: PledgeTerms }) {
  return (
    <div className="mt-3 border border-black bg-accent-soft px-3 py-2 text-xs text-ink">
      <p>
        Labor Pledge: this work would take a person about {pledge.hours} hours. At a living wage of{" "}
        {formatUsdCents(pledge.hourlyWage)} an hour, that is {formatUsdCents(pledge.laborValue)} of labor. From this fee,
        easier.company contributes {formatUsdCents(pledge.contribution)} ({Math.round(LABOR_PLEDGE.rate * 1000) / 10}%) to{" "}
        {LABOR_PLEDGE.recipient}.
      </p>
      <details className="mt-1">
        <summary className="cursor-pointer text-link underline">How the hours are estimated</summary>
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
  error: ["Must fix", "bg-danger"],
  warning: ["Review", "bg-[#ffcc00]"],
  info: ["Note", "bg-accent"],
};

export function Findings({ findings }: { findings: Finding[] }) {
  if (!findings.length) return <p className="text-sm">No findings. All checks passed.</p>;
  return (
    <ul className="sunken space-y-0 bg-white p-1">
      {findings.map((f, i) => (
        <li key={i} className="flex items-start gap-2 px-2 py-1.5 text-sm">
          <span
            aria-hidden="true"
            className={`mt-1 inline-block h-2.5 w-2.5 shrink-0 border border-black ${SEVERITY[f.severity][1]}`}
          />
          <span>
            <span className="mr-1 font-bold">{SEVERITY[f.severity][0]}:</span>
            {f.message}
            {f.ref && <span className="ml-2 text-xs text-muted">({f.ref})</span>}
          </span>
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
            <dl className="sunken grid gap-x-8 bg-white p-2 text-sm sm:grid-cols-2">
              {s.fields.map((f) => (
                <div key={f.label} className="flex justify-between gap-4 border-b border-dotted border-line py-1">
                  <dt className="text-muted">
                    {f.label}
                    {f.ref && <span className="ml-1 text-xs">({f.ref})</span>}
                  </dt>
                  <dd className="text-right tabular-nums">{f.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <div className="sunken overflow-x-auto bg-white p-[2px]">
              <table className="listview w-full text-sm">
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
                    <tr className="border-t border-black font-bold">
                      {s.columns.map((c) => (
                        <td key={c.key} className={c.numeric ? "text-right tabular-nums" : ""}>
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

const input = "field sunken w-full text-sm";

function Field({ f, name, values = {} }: { f: FieldSpec; name: string; values?: Record<string, string> }) {
  const v = values[name];
  const label = (
    <span className="mb-1 block text-sm">
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
        <fieldset className="flex flex-wrap items-center justify-between gap-3 border-b border-dotted border-line py-2">
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

/** Beveled push button. "primary" is the dialog's default button; "danger" marks destructive choices in red text. */
export const buttonClass = (variant: "primary" | "quiet" | "danger" = "quiet") =>
  `btn raised ${variant === "primary" ? "btn-default font-bold" : ""} ${variant === "danger" ? "text-danger!" : ""}`;

export const Button = ({ children, variant = "primary", ...rest }: { children: ReactNode; variant?: "primary" | "quiet" | "danger" } & React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button {...rest} className={`${buttonClass(variant)} ${rest.className ?? ""}`}>
    {children}
  </button>
);

export const inputClass = input;
