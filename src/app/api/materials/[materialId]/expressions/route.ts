import { NextRequest, NextResponse } from "next/server";
import { createMaterialExpression, listMaterialExpressions } from "@/lib/server/materials";
import { resolveRequestUser } from "@/lib/server/requestUser";

export const runtime = "nodejs";

type ExpressionPayload = {
  expression?: unknown;
  meaning?: unknown;
  exampleSentence?: unknown;
};

function normalizeExpressionPayload(payload: ExpressionPayload) {
  const expression = typeof payload.expression === "string" ? payload.expression.trim() : "";
  const meaning = typeof payload.meaning === "string" ? payload.meaning.trim() : "";
  const exampleSentence = typeof payload.exampleSentence === "string" ? payload.exampleSentence.trim() : "";

  if (!expression || !meaning || !exampleSentence) {
    return null;
  }

  return { expression, meaning, exampleSentence };
}

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

  const expressions = await listMaterialExpressions(user.uid, materialId);
  if (!expressions) {
    return NextResponse.json({ error: "Material not found" }, { status: 404 });
  }

  return NextResponse.json({ expressions });
}

export async function POST(
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

  let payload: ExpressionPayload;
  try {
    payload = (await request.json()) as ExpressionPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const normalized = normalizeExpressionPayload(payload);
  if (!normalized) {
    return NextResponse.json(
      { error: "expression, meaning, and exampleSentence are required" },
      { status: 400 },
    );
  }

  const expression = await createMaterialExpression(user.uid, materialId, normalized);
  if (!expression) {
    return NextResponse.json({ error: "Material not found" }, { status: 404 });
  }

  return NextResponse.json({ expression }, { status: 201 });
}
