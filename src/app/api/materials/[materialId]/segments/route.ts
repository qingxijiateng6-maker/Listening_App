import { NextRequest, NextResponse } from "next/server";
import { listMaterialSegments } from "@/lib/server/materials";
import { resolveRequestUser } from "@/lib/server/requestUser";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ materialId: string }> },
) {
  const user = await resolveRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { materialId } = await params;
  if (!materialId) {
    return NextResponse.json({ error: "materialId is required" }, { status: 400 });
  }

  const segments = await listMaterialSegments(user.uid, materialId);
  if (!segments) {
    return NextResponse.json({ error: "Material not found" }, { status: 404 });
  }

  return NextResponse.json({ segments });
}
