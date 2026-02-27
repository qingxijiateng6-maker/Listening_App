import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { buildFallbackMeaningJa, glossaryHash, normalizeSurfaceText } from "@/lib/glossary";

export const runtime = "nodejs";

type GlossaryRequestBody = {
  surfaceText?: string;
};

export async function POST(
  request: NextRequest,
  { params }: { params: { materialId: string } },
) {
  const startedAt = Date.now();
  const body = (await request.json()) as GlossaryRequestBody;
  const rawSurfaceText = body.surfaceText ?? "";
  const surfaceText = normalizeSurfaceText(rawSurfaceText);
  const { materialId } = params;

  if (!surfaceText) {
    return NextResponse.json({ error: "surfaceText is required" }, { status: 400 });
  }

  const db = getAdminDb();
  const hash = glossaryHash(surfaceText);
  const glossaryRef = db.collection("materials").doc(materialId).collection("glossary").doc(hash);

  const cached = await glossaryRef.get();
  if (cached.exists) {
    const data = cached.data() as { meaningJa: string } | undefined;
    return NextResponse.json({
      surfaceText,
      meaningJa: data?.meaningJa ?? buildFallbackMeaningJa(surfaceText),
      cacheHit: true,
      latencyMs: Date.now() - startedAt,
    });
  }

  const generatedMeaningJa = buildFallbackMeaningJa(surfaceText);
  await glossaryRef.set({
    surfaceText,
    meaningJa: generatedMeaningJa,
    createdAt: Timestamp.now(),
  });

  return NextResponse.json({
    surfaceText,
    meaningJa: generatedMeaningJa,
    cacheHit: false,
    latencyMs: Date.now() - startedAt,
  });
}
