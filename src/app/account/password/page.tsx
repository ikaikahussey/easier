import { setPasswordAction } from "@/app/actions";
import { hasPassword, MIN_PASSWORD_LENGTH } from "@/core/services/auth";
import { Button, Card, Notice, PageTitle, Shell, inputClass } from "@/ui/components";
import { requireActor } from "@/ui/session";

export default async function Password({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; setup?: string }>;
}) {
  const actor = await requireActor();
  const { error, saved, setup } = await searchParams;
  const existing = await hasPassword(actor.id);
  const home = actor.role === "client" ? "/app" : "/review";
  return (
    <Shell actor={actor}>
      <div className="mx-auto max-w-md">
        <PageTitle kicker={actor.email}>{existing ? "Change password" : "Set a password"}</PageTitle>
        <Notice
          error={error}
          success={saved ? "Password saved. Next time, sign in with your email and password." : undefined}
        />
        {setup && !existing && (
          <p className="mb-4 text-sm text-muted">
            Set a password now to sign in without waiting for an emailed link. You can{" "}
            <a href={home}>skip this</a> and keep using emailed links.
          </p>
        )}
        <Card>
          <form action={setPasswordAction} className="space-y-4">
            {existing && (
              <label className="block">
                <span className="mb-1 block text-sm font-bold">Current password</span>
                <input name="current" type="password" required autoComplete="current-password" className={inputClass} />
              </label>
            )}
            <label className="block">
              <span className="mb-1 block text-sm font-bold">New password</span>
              <input
                name="password"
                type="password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                autoComplete="new-password"
                className={inputClass}
              />
              <span className="mt-1 block text-xs text-muted">At least {MIN_PASSWORD_LENGTH} characters.</span>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-bold">Confirm new password</span>
              <input name="confirm" type="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" className={inputClass} />
            </label>
            <Button type="submit">Save password</Button>
          </form>
        </Card>
        <p className="mt-4 text-sm text-muted">
          Forgot your password? Sign out and request an emailed sign-in link; it brings you back here to set a new one.
        </p>
      </div>
    </Shell>
  );
}
