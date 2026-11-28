"use server";

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { CryptoError } from "@/core/crypto";
import { ForbiddenError, NotFoundError, ValidationError } from "@/core/services/context";
import { joinWaitlist } from "@/core/services/auth";
import {
  acceptTerms,
  addContractor,
  addPerson,
  assignDuty,
  enroll,
  fileMis,
  logIncident,
  markReported,
  orderTest,
  part120Enabled,
  recordCollection,
  recordNotAdministered,
  recordPersonStep,
  recordResult,
  runDraw,
  setCoverage,
  setMisNotified,
} from "@/programs/part-120/service";
import { requireActor } from "@/ui/session";
import { HOUR, limit } from "@/ui/throttle";

const VIEWS = ["dashboard", "roster", "random", "events", "records", "contractors", "audit", "mis"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function message(err: unknown): string {
  if (err instanceof ValidationError) return err.issues.join(" · ");
  if (err instanceof ForbiddenError) return err.message;
  if (err instanceof NotFoundError || err instanceof CryptoError) return "Not found";
  console.error(err);
  return "Something went wrong. Please try again.";
}

/** Every Part 120 form posts here with an `op`. Works as a plain form post, without JavaScript. */
export async function p120Action(fd: FormData) {
  if (!part120Enabled()) notFound();
  const actor = await requireActor();
  const s = (k: string) => {
    const v = fd.get(k);
    return typeof v === "string" ? v : "";
  };
  const on = (k: string) => fd.get(k) === "on";
  const all = (k: string) => fd.getAll(k).filter((v): v is string => typeof v === "string");
  const opt = (k: string) => s(k) || undefined;

  const orgId = s("orgId");
  if (!UUID.test(orgId)) notFound();
  const view = VIEWS.includes(s("view")) ? s("view") : "dashboard";
  const id = s("id");
  if (id && !UUID.test(id)) notFound();
  const back = `/p120/${orgId}?view=${view}${view === "roster" && s("person") && UUID.test(s("person")) ? `&open=${s("person")}` : ""}`;

  try {
    switch (s("op")) {
      case "enroll":
        if (!on("accept")) throw new ValidationError(["Accept the terms to start the program"]);
        await enroll(actor, orgId, { operation: s("operation"), registrationKind: s("registrationKind"), registrationRef: s("registrationRef"), timeZone: s("timeZone"), termsHash: s("termsHash"), signerName: s("signerName"), signerTitle: s("signerTitle") });
        break;
      case "accept_terms":
        if (!on("accept")) throw new ValidationError(["Accept the terms to continue"]);
        await acceptTerms(actor, orgId, { termsHash: s("termsHash"), signerName: s("signerName"), signerTitle: s("signerTitle") });
        break;
      case "add_person":
        await addPerson(actor, orgId, { name: s("name"), title: s("title"), functions: all("functions"), supervisor: on("supervisor"), medical: on("medical"), airman: on("airman"), hiredOn: opt("hiredOn"), contractorId: opt("contractorId") });
        break;
      case "consent":
        await recordPersonStep(actor, orgId, id, { step: "consent", on: s("on"), refused: s("refused") === "1" });
        break;
      case "asked":
        await recordPersonStep(actor, orgId, id, { step: "asked", on: s("on"), admitted: on("admitted") });
        break;
      case "no_prior_dot":
        await recordPersonStep(actor, orgId, id, { step: "no_prior_dot" });
        break;
      case "prior_employer":
        await recordPersonStep(actor, orgId, id, { step: "prior_employer", name: s("name"), requestedOn: opt("requestedOn") });
        break;
      case "prior_response":
        await recordPersonStep(actor, orgId, id, { step: "prior_response", index: Number(s("index")), receivedOn: s("receivedOn"), violation: on("violation") });
        break;
      case "good_faith":
        await recordPersonStep(actor, orgId, id, { step: "good_faith", on: s("on"), note: s("note") });
        break;
      case "return_to_duty":
        await recordPersonStep(actor, orgId, id, { step: "return_to_duty", on: s("on") });
        break;
      case "training":
        await recordPersonStep(actor, orgId, id, { step: "training", kind: s("kind"), on: s("on"), minutes: Number(s("minutes")) });
        break;
      case "separate":
        await recordPersonStep(actor, orgId, id, { step: "separate", on: s("on") });
        break;
      case "assign_duty":
        await assignDuty(actor, orgId, id, { on: opt("on") });
        break;
      case "order_test":
        await orderTest(actor, orgId, { personId: id, reason: s("reason"), substance: s("substance"), on: opt("on") });
        break;
      case "result":
        await recordResult(actor, orgId, id, { result: s("result"), verifiedOn: s("verifiedOn"), collectedOn: opt("collectedOn") });
        break;
      case "collection":
        await recordCollection(actor, orgId, id, { collectedLocal: s("collectedLocal"), delayReason: opt("delayReason") });
        break;
      case "not_administered":
        await recordNotAdministered(actor, orgId, id, { reason: s("reason") });
        break;
      case "reported":
        await markReported(actor, orgId, id, { to: s("to"), on: s("on") });
        break;
      case "draw":
        await runDraw(actor, orgId);
        break;
      case "incident":
        await logIncident(actor, orgId, { kind: s("kind"), personId: s("personId"), occurredLocal: s("occurredLocal"), note: s("note"), testingRequired: on("testingRequired") });
        break;
      case "add_contractor":
        await addContractor(actor, orgId, { name: s("name"), work: s("work"), functions: all("functions") });
        break;
      case "coverage":
        await setCoverage(actor, orgId, id, { coverage: s("coverage"), evidenceRef: opt("evidenceRef"), evidenceOn: opt("evidenceOn") });
        break;
      case "mis_notice":
        await setMisNotified(actor, orgId, s("notified") === "1");
        break;
      case "mis_file":
        await fileMis(actor, orgId, { year: Number(s("year")), filedOn: s("filedOn"), certifiedBy: s("certifiedBy") });
        break;
      default:
        throw new ValidationError(["Unknown action"]);
    }
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) throw err; // redirect() and notFound() control flow
    redirect(`${back}&error=${encodeURIComponent(message(err))}`);
  }
  revalidatePath(`/p120/${orgId}`);
  redirect(back);
}

/** Public request for access from the operator page. Stored on the waitlist as an aviation contact. */
export async function requestPart120AccessAction(fd: FormData) {
  if (!part120Enabled()) notFound();
  const email = fd.get("email");
  try {
    await limit("waitlist", 10, HOUR);
    await joinWaitlist(typeof email === "string" ? email : "", "aviation");
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) throw err;
    redirect(`/part-120?error=${encodeURIComponent(message(err))}#access`);
  }
  redirect("/part-120?requested=1#access");
}
