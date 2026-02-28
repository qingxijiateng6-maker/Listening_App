import { NextResponse } from "next/server";
import { getMaterial } from "@/lib/server/materials";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ materialId: string }> },
) {
  const { materialId } = await params;
  if (!materialId) {
    return NextResponse.json({ error: "materialId is required" }, { status: 400 });
  }

  const material = await getMaterial(materialId);
  if (!material) {
    return NextResponse.json({ error: "Material not found" }, { status: 404 });
  }

  return NextResponse.json({
    material,
    status: material.status,
  });
}
