import { NextResponse } from "next/server";
import { listMaterialSegments } from "@/lib/server/materials";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ materialId: string }> },
) {
  const { materialId } = await params;
  if (!materialId) {
    return NextResponse.json({ error: "materialId is required" }, { status: 400 });
  }

  const segments = await listMaterialSegments(materialId);
  if (!segments) {
    return NextResponse.json({ error: "Material not found" }, { status: 404 });
  }

  return NextResponse.json({ segments });
}
