import { NextResponse } from "next/server";
import { flatten, toCsv } from "@/core/flatten";
import { requireActor } from "@/ui/session";
import { signedExport } from "../export";

/** The approved return as a two-column keying sheet (field, value) for entry into e-file software. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const out = await signedExport(await requireActor(), (await params).id);
  if (!out) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(toCsv(flatten(out.body)), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${out.name}-keying-sheet.csv"`,
    },
  });
}
