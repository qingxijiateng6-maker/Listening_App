import { getAdminDb } from "@/lib/firebase/admin";
import type { Expression, Material, Segment } from "@/types/domain";

export type MaterialRecord = Material & {
  materialId: string;
};

export type SegmentRecord = Segment & {
  segmentId: string;
};

export type ExpressionRecord = Expression & {
  expressionId: string;
};

async function getMaterialSnapshot(materialId: string) {
  return getAdminDb().collection("materials").doc(materialId).get();
}

export async function getMaterial(materialId: string): Promise<MaterialRecord | null> {
  const snapshot = await getMaterialSnapshot(materialId);
  if (!snapshot.exists) {
    return null;
  }

  return {
    materialId: snapshot.id,
    ...(snapshot.data() as Material),
  };
}

export async function listMaterialSegments(materialId: string): Promise<SegmentRecord[] | null> {
  const materialSnapshot = await getMaterialSnapshot(materialId);
  if (!materialSnapshot.exists) {
    return null;
  }

  const snapshot = await materialSnapshot.ref.collection("segments").get();
  return snapshot.docs
    .map((docSnapshot) => ({
      segmentId: docSnapshot.id,
      ...(docSnapshot.data() as Segment),
    }))
    .sort(
      (left, right) =>
        left.startMs - right.startMs || left.endMs - right.endMs || left.segmentId.localeCompare(right.segmentId),
    );
}

export async function listMaterialExpressions(
  materialId: string,
): Promise<ExpressionRecord[] | null> {
  const materialSnapshot = await getMaterialSnapshot(materialId);
  if (!materialSnapshot.exists) {
    return null;
  }

  const snapshot = await materialSnapshot.ref.collection("expressions").get();
  return snapshot.docs
    .map((docSnapshot) => ({
      expressionId: docSnapshot.id,
      ...(docSnapshot.data() as Expression),
    }))
    .sort(
      (left, right) =>
        right.scoreFinal - left.scoreFinal ||
        right.createdAt.toMillis() - left.createdAt.toMillis() ||
        left.expressionId.localeCompare(right.expressionId),
    );
}
