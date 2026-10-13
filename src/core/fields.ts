import { z } from "zod";

/**
 * Declarative field specs. A product declares its intake once; the same spec
 * drives the validation schema, the rendered form, and form-data parsing.
 */
interface Base {
  name: string;
  label: string;
  help?: string;
  required?: boolean;
}

export type FieldSpec =
  | (Base & { type: "text" | "textarea" | "email"; maxLength?: number })
  | (Base & { type: "number" | "money"; min?: number; max?: number })
  | (Base & { type: "percent" })
  | (Base & { type: "checkbox" })
  | (Base & { type: "yesno" })
  | (Base & { type: "select"; options: readonly { value: string; label: string }[] })
  | (Base & { type: "date" })
  | (Base & { type: "list"; rows: number; fields: FieldSpec[] });

export interface FormSection {
  title: string;
  help?: string;
  /** Render folded; for questions that apply only to some clients. */
  collapsible?: boolean;
  fields: FieldSpec[];
}

export type FormSpec = FormSection[];

const blankToUndefined = (v: unknown) => (v === "" || v === null ? undefined : v);

function fieldSchema(f: FieldSpec): z.ZodType {
  let s: z.ZodType;
  switch (f.type) {
    case "text":
    case "textarea":
      s = z.string().trim().min(1).max(f.maxLength ?? (f.type === "text" ? 300 : 5000));
      break;
    case "email":
      s = z.string().trim().toLowerCase().pipe(z.email());
      break;
    case "number":
    case "money": {
      let n = z.coerce.number().finite();
      if (f.type === "money") n = n.min(f.min ?? 0);
      else if (f.min !== undefined) n = n.min(f.min);
      if (f.max !== undefined) n = n.max(f.max);
      s = n;
      break;
    }
    case "percent":
      s = z.coerce.number().min(0).max(100);
      break;
    case "checkbox":
      // Unchecked boxes are absent from form data, so a checkbox is never "missing".
      return z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean());
    case "yesno":
      s = z.preprocess(
        (v) => (v === "yes" || v === true ? true : v === "no" || v === false ? false : v),
        z.boolean(),
      );
      break;
    case "select": {
      const values = f.options.map((o) => o.value);
      s = z.string().refine((v) => values.includes(v), { message: `Must be one of: ${values.join(", ")}` });
      break;
    }
    case "date":
      s = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
      break;
    case "list": {
      const row = objectSchema(f.fields);
      const arr = z.preprocess(
        (v) => (Array.isArray(v) ? v.filter((r) => !isBlankRow(r)) : v),
        f.required ? z.array(row).min(1) : z.array(row),
      );
      return f.required ? arr : z.preprocess((v) => v ?? [], arr);
    }
  }
  return f.required ? z.preprocess(blankToUndefined, s) : z.preprocess(blankToUndefined, s.optional());
}

function isBlankRow(r: unknown): boolean {
  if (!r || typeof r !== "object") return true;
  return Object.values(r).every((v) => v === undefined || v === null || String(v).trim() === "");
}

export function objectSchema(fields: FieldSpec[]) {
  const shape: Record<string, z.ZodType> = {};
  for (const f of fields) shape[f.name] = fieldSchema(f);
  return z.object(shape);
}

export const allFields = (form: FormSpec): FieldSpec[] => form.flatMap((s) => s.fields);

export const formSchema = (form: FormSpec) => objectSchema(allFields(form));

/** Convert flat form data (`list.0.field` naming) into the nested shape the schema expects. */
export function formDataToObject(fd: FormData, fields: FieldSpec[], prefix = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const key = prefix + f.name;
    if (f.type === "list") {
      const rows: Record<string, unknown>[] = [];
      for (let i = 0; i < f.rows; i++) rows.push(formDataToObject(fd, f.fields, `${key}.${i}.`));
      out[f.name] = rows;
    } else {
      const v = fd.get(key);
      out[f.name] = typeof v === "string" ? v : undefined;
    }
  }
  return out;
}

export function parseForm<T>(fd: FormData, form: FormSpec): { ok: true; data: T } | { ok: false; errors: string[] } {
  const raw = formDataToObject(fd, allFields(form));
  const result = formSchema(form).safeParse(raw);
  if (result.success) return { ok: true, data: result.data as T };
  return {
    ok: false,
    errors: result.error.issues.map((i) => `${labelFor(form, i.path)}: ${i.message}`),
  };
}

function labelFor(form: FormSpec, path: PropertyKey[]): string {
  let fields = allFields(form);
  const labels: string[] = [];
  for (const p of path) {
    if (typeof p === "number") {
      labels.push(`row ${p + 1}`);
      continue;
    }
    const f = fields.find((x) => x.name === p);
    if (!f) break;
    labels.push(f.label);
    if (f.type === "list") fields = f.fields;
  }
  return labels.join(" › ") || path.join(".");
}

/** Inverse of formDataToObject: saved answers → form field values, for editing a submitted form. */
export function objectToFormValues(fields: FieldSpec[], obj: Record<string, unknown> | undefined, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  if (!obj) return out;
  for (const f of fields) {
    const key = prefix + f.name;
    const v = obj[f.name];
    if (v === undefined || v === null) continue;
    if (f.type === "list") {
      if (Array.isArray(v)) v.forEach((row, i) => Object.assign(out, objectToFormValues(f.fields, row as Record<string, unknown>, `${key}.${i}.`)));
    } else if (f.type === "yesno") out[key] = v ? "yes" : "no";
    else if (f.type === "checkbox") {
      if (v) out[key] = "on";
    } else out[key] = String(v);
  }
  return out;
}
