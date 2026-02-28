import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { buildFallbackMeaningJa, glossaryHash, normalizeSurfaceText } from "@/lib/glossary";
import { generateGlossaryMeaningJaWithOpenAI, isOpenAIEnabled } from "@/lib/llm/openai";

export const runtime = "nodejs";

type GlossaryRequestBody = {
  surfaceText?: string;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ materialId: string }> },
) {
  const startedAt = Date.now();
  const body = (await request.json()) as GlossaryRequestBody;
  const rawSurfaceText = body.surfaceText ?? "";
  const normalizedSurfaceText = normalizeSurfaceText(rawSurfaceText);
  const { materialId } = await params;

  if (!normalizedSurfaceText) {
    return NextResponse.json({ error: "surfaceText is required" }, { status: 400 });
  }

  const db = getAdminDb();
  const hash = glossaryHash(normalizedSurfaceText);
  const glossaryRef = db.collection("materials").doc(materialId).collection("glossary").doc(hash);

  const cached = await glossaryRef.get();
  if (cached.exists) {
    const data = cached.data() as { meaningJa: string } | undefined;
    return NextResponse.json({
      surfaceText: normalizedSurfaceText,
      meaningJa: data?.meaningJa ?? buildFallbackMeaningJa(normalizedSurfaceText),
      cacheHit: true,
      latencyMs: Date.now() - startedAt,
    });
  }

  let generatedMeaningJa = buildFallbackMeaningJa(normalizedSurfaceText);
  if (isOpenAIEnabled()) {
    try {
      generatedMeaningJa = await generateGlossaryMeaningJaWithOpenAI(normalizedSurfaceText);
    } catch {
      generatedMeaningJa = buildFallbackMeaningJa(normalizedSurfaceText);
    }
  }
  await glossaryRef.set({
    surfaceText: normalizedSurfaceText,
    meaningJa: generatedMeaningJa,
    createdAt: Timestamp.now(),
  });

  return NextResponse.json({
    surfaceText: normalizedSurfaceText,
    meaningJa: generatedMeaningJa,
    cacheHit: false,
    latencyMs: Date.now() - startedAt,
  });
}
