import { NextResponse } from "next/server";
import { requireActor } from "@/ui/session";
import { signedExport } from "../export";

/** The approved return as line-numbered JSON, for entry into filing software. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const out = await signedExport(await requireActor(), (await params).id);
  if (!out) return new NextResponse("Not found", { status: 404 });
  return NextResponse.json(out.body, { headers: { "content-disposition": `attachment; filename="${out.name}.json"` } });
}
