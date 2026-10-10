import { requestLoginAction } from "@/app/actions";
import { Button, Card, Notice, Shell, inputClass } from "@/ui/components";

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string; sent?: string }> }) {
  const { error, sent } = await searchParams;
  return (
    <Shell>
      <div className="mx-auto max-w-md">
        <h1 className="mb-6 text-3xl font-semibold">Sign in</h1>
        <Notice error={error} success={sent ? "Check your email for a sign-in link. It expires in 15 minutes." : undefined} />
        <Card>
          <form action={requestLoginAction} className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Email</span>
              <input name="email" type="email" required autoComplete="email" className={inputClass} />
            </label>
            <Button type="submit">Email me a sign-in link</Button>
          </form>
        </Card>
      </div>
    </Shell>
  );
}
