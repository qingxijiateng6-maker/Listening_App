import { NextResponse } from "next/server";
import { createMaterialExpression, listMaterialExpressions } from "@/lib/server/materials";

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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ materialId: string }> },
) {
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

  const expression = await createMaterialExpression(materialId, normalized);
  if (!expression) {
    return NextResponse.json({ error: "Material not found" }, { status: 404 });
  }

  return NextResponse.json({ expression }, { status: 201 });
}
