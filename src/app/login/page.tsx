import { passwordLoginAction, requestLoginAction } from "@/app/actions";
import { Button, Card, Notice, PageTitle, Shell, inputClass } from "@/ui/components";

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string; sent?: string }> }) {
  const { error, sent } = await searchParams;
  return (
    <Shell>
      <div className="mx-auto max-w-md">
        <PageTitle kicker="Invitation only until launch">Sign in</PageTitle>
        <Notice
          error={error}
          success={sent ? "If this email has access, a sign-in link is on its way. It expires in 15 minutes. If not, you are on the waitlist." : undefined}
        />
        <Card>
          <form action={passwordLoginAction} className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-sm font-bold">Email</span>
              <input name="email" type="email" required autoComplete="email" className={inputClass} />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-bold">Password</span>
              <input name="password" type="password" required autoComplete="current-password" className={inputClass} />
            </label>
            <Button type="submit">Sign in</Button>
          </form>
        </Card>
        <Card title="No password yet, or forgot it?">
          <p className="mb-4 text-sm text-muted">
            We will email you a single-use sign-in link. First-time users and anyone resetting a password sign in this way, then set a password.
          </p>
          <form action={requestLoginAction} className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-sm font-bold">Email</span>
              <input name="email" type="email" required autoComplete="email" className={inputClass} />
            </label>
            <Button type="submit" variant="quiet">
              Email me a sign-in link
            </Button>
          </form>
        </Card>
      </div>
    </Shell>
  );
}
