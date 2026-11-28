import type { Metadata } from "next";
import { SiteDocumentPage } from "@/ui/site-document";

export const metadata: Metadata = { title: "Privacy policy — easier.company" };

// The contact address is read per request; without this the page is fixed at build time.
export const dynamic = "force-dynamic";

export default function Page() {
  return <SiteDocumentPage id="privacy" />;
}
