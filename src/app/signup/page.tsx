import Link from "next/link";
import { signUpAction } from "@/app/actions";
import { MIN_PASSWORD_LENGTH } from "@/core/services/auth";
import { Button, Card, Notice, PageTitle, Shell, inputClass } from "@/ui/components";

export default async function SignUp({ searchParams }: { searchParams: Promise<{ error?: string; pending?: string }> }) {
  const { error, pending } = await searchParams;
  return (
    <Shell>
      <div className="mx-auto max-w-md">
        <PageTitle kicker="Invitation only until launch">Create your account</PageTitle>
        <Notice
          error={error}
          success={
            pending
              ? "We could not create an account for this email right now. If it already has an account, sign in instead. If it does not have access yet, it is on the waitlist and we will be in touch."
              : undefined
          }
        />
        <Card>
          <form action={signUpAction} className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-sm font-bold">Your name</span>
              <input name="name" type="text" autoComplete="name" maxLength={120} className={inputClass} />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-bold">Email</span>
              <input name="email" type="email" required autoComplete="email" className={inputClass} />
              <span className="mt-1 block text-xs text-muted">This is your username. We will send a confirmation link to it.</span>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-bold">Password</span>
              <input name="password" type="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" className={inputClass} />
              <span className="mt-1 block text-xs text-muted">At least {MIN_PASSWORD_LENGTH} characters.</span>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-bold">Confirm password</span>
              <input name="confirm" type="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" className={inputClass} />
            </label>
            <Button type="submit">Create account</Button>
          </form>
        </Card>
        <p className="mt-4 text-sm text-muted">
          Already have an account? <Link href="/login">Sign in</Link>.
        </p>
      </div>
    </Shell>
  );
}
