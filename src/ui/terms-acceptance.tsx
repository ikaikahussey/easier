import Link from "next/link";
import { siteTerms } from "@/core/site-terms";

/** The checkbox and hidden hash a form posts to record acceptance of the site terms and privacy policy. */
export function TermsAcceptance() {
  return (
    <>
      <input type="hidden" name="termsHash" value={siteTerms().hash} />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="accept" required className="mt-1" />
        <span>
          I have read and accept the{" "}
          <Link href="/terms" target="_blank">
            terms of service
          </Link>{" "}
          and the{" "}
          <Link href="/privacy" target="_blank">
            privacy policy
          </Link>
          .
        </span>
      </label>
    </>
  );
}
