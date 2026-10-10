"use client";

import { useActionState } from "react";
import { createEngagementAction, type FormState } from "@/app/actions";
import type { FormSpec } from "@/core/fields";
import { Button, Card, FormFields, Notice, inputClass } from "./components";

export function IntakeForm(props: { orgId: string; product: string; periodLabel: string; form: FormSpec }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createEngagementAction, {});
  const values = state.values ?? {};
  return (
    <form action={action}>
      <Notice error={state.error} />
      <input type="hidden" name="orgId" value={props.orgId} />
      <input type="hidden" name="product" value={props.product} />
      <Card title="Period">
        <label className="block max-w-xs">
          <span className="mb-1 block text-sm font-medium">{props.periodLabel} *</span>
          <input name="period" type="date" required className={inputClass} defaultValue={values.period} />
        </label>
      </Card>
      {/* Remount on each failed submit so defaults reflect the returned values. */}
      <div key={JSON.stringify(values).length}>
        <FormFields form={props.form} values={values} />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Continue to document upload"}
      </Button>
    </form>
  );
}
