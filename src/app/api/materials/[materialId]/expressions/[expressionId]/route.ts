import { NextResponse } from "next/server";
import { deleteMaterialExpression } from "@/lib/server/materials";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ materialId: string; expressionId: string }> },
) {
  const { materialId, expressionId } = await params;
  if (!materialId || !expressionId) {
    return NextResponse.json({ error: "materialId and expressionId are required" }, { status: 400 });
  }

  const result = await deleteMaterialExpression(materialId, expressionId);
  if (result === null) {
    return NextResponse.json({ error: "Material not found" }, { status: 404 });
  }
  if (result === false) {
    return NextResponse.json({ error: "Expression not found" }, { status: 404 });
  }

  return new NextResponse(null, { status: 204 });
}
