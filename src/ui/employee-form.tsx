"use client";

import { useActionState } from "react";
import { saveEmployeeAction, type FormState } from "@/app/actions";
import { EMPLOYEE_FORM } from "@/products/payroll/employee-form";
import { Button, FormFields, Notice } from "./components";

export function EmployeeForm(props: { orgId: string; employeeId?: string; initial?: Record<string, string> }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveEmployeeAction, {});
  const values = state.values ?? props.initial ?? {};
  return (
    <form action={action}>
      <Notice error={state.error} />
      <input type="hidden" name="orgId" value={props.orgId} />
      {props.employeeId && <input type="hidden" name="employeeId" value={props.employeeId} />}
      <div key={JSON.stringify(values).length}>
        <FormFields form={EMPLOYEE_FORM} values={values} />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : props.employeeId ? "Save employee" : "Add employee"}
      </Button>
    </form>
  );
}
