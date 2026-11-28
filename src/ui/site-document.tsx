import { configuredContact, siteDocuments, type SiteDocumentId } from "@/core/site-terms";
import { PageTitle, Shell } from "@/ui/components";
import { currentActor } from "@/ui/session";

/** A site-wide legal document, rendered from the same text whose hash an account accepts. */
export async function SiteDocumentPage({ id }: { id: SiteDocumentId }) {
  const doc = siteDocuments()[id];
  const actor = await currentActor();
  return (
    <Shell actor={actor}>
      <article className="mx-auto max-w-[72ch]">
        <PageTitle kicker={`Version ${doc.version}`}>{doc.title}</PageTitle>
        {!configuredContact() && <p className="mb-4 text-sm text-danger">A contact address has not been configured for this site yet.</p>}
        {doc.sections.map((s) => (
          <section key={s.heading} className="mb-6">
            <h2 className="text-xl">{s.heading}</h2>
            {s.paragraphs.map((p) => (
              <p key={p} className="mt-2 text-[15px]">
                {p}
              </p>
            ))}
          </section>
        ))}
      </article>
    </Shell>
  );
}
