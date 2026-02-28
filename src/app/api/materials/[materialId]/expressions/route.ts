import { NextResponse } from "next/server";
import { listMaterialExpressions } from "@/lib/server/materials";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ materialId: string }> },
) {
  const { materialId } = await params;
  if (!materialId) {
    return NextResponse.json({ error: "materialId is required" }, { status: 400 });
  }

  const expressions = await listMaterialExpressions(materialId);
  if (!expressions) {
    return NextResponse.json({ error: "Material not found" }, { status: 404 });
  }

  return NextResponse.json({ expressions });
}
