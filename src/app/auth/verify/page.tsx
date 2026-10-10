import { verifyLoginAction } from "@/app/actions";
import { Button, Card, Shell } from "@/ui/components";

export default async function Verify({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <Shell>
      <div className="mx-auto max-w-md">
        <Card title="Finish signing in">
          <form action={verifyLoginAction}>
            <input type="hidden" name="token" value={token ?? ""} />
            <Button type="submit">Continue to Plainfirm</Button>
          </form>
        </Card>
      </div>
    </Shell>
  );
}
