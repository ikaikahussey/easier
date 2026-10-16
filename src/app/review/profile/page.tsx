import { submitCredentialAction } from "@/app/actions";
import { CREDENTIAL_TYPES, getReviewerProfile } from "@/core/services/reviewers";
import { Button, Card, Notice, PageTitle, Shell, inputClass } from "@/ui/components";
import { requireStaff } from "@/ui/session";

export default async function ReviewerProfilePage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const actor = await requireStaff();
  const { error, saved } = await searchParams;
  const p = await getReviewerProfile(actor);
  const state = p.verifiedAt
    ? `Verified ${p.verifiedAt.toISOString().slice(0, 10)}. You can sign work that accepts ${p.credentialType}.`
    : p.submittedAt
      ? "Submitted. An admin will verify it with the issuing body before you can sign."
      : "Not submitted. You cannot sign work until your credential is recorded and verified.";

  return (
    <Shell actor={actor}>
      <div className="mx-auto max-w-xl">
        <PageTitle kicker={actor.email}>Your credential</PageTitle>
        <Notice error={error} success={saved ? "Saved. An admin will verify it." : undefined} />
        <Card title="Status">
          <p className={`text-sm ${p.verifiedAt ? "" : "text-danger"}`}>{state}</p>
        </Card>
        <Card title="Credential">
          <form action={submitCredentialAction} className="space-y-4">
            <p className="text-xs text-muted">Changing any field clears verification until an admin checks it again.</p>
            <label className="block text-sm">
              <span className="mb-1 block font-bold">Name as it appears on the return</span>
              <input name="name" required defaultValue={p.name ?? ""} autoComplete="name" className={inputClass} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-bold">Credential</span>
              <select name="credentialType" required defaultValue={p.credentialType ?? ""} className={inputClass}>
                <option value="" disabled>
                  Choose
                </option>
                {CREDENTIAL_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1 block font-bold">License or enrollment number</span>
                <input name="credentialNumber" required defaultValue={p.credentialNumber ?? ""} className={inputClass} />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-bold">Issued by</span>
                <input
                  name="credentialJurisdiction"
                  required
                  placeholder="IRS, or state (e.g. HI)"
                  defaultValue={p.credentialJurisdiction ?? ""}
                  className={inputClass}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-bold">PTIN</span>
                <input name="ptin" required pattern="[Pp][0-9]{8}" placeholder="P12345678" defaultValue={p.ptin ?? ""} className={`${inputClass} font-mono`} />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-bold">EFIN (if you transmit returns)</span>
                <input name="efin" pattern="[0-9]{6}" defaultValue={p.efin ?? ""} className={`${inputClass} font-mono`} />
              </label>
            </div>
            <Button type="submit">Save credential</Button>
          </form>
        </Card>
      </div>
    </Shell>
  );
}
