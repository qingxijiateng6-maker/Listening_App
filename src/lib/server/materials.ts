import { getAdminDb } from "@/lib/firebase/admin";
import type { Material, SavedExpression, Segment } from "@/types/domain";

export type MaterialRecord = Material & {
  materialId: string;
};

export type SegmentRecord = Segment & {
  segmentId: string;
};

export type SavedExpressionRecord = SavedExpression & {
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

export async function listMaterialExpressions(materialId: string): Promise<SavedExpressionRecord[] | null> {
  const materialSnapshot = await getMaterialSnapshot(materialId);
  if (!materialSnapshot.exists) {
    return null;
  }

  const snapshot = await materialSnapshot.ref.collection("expressions").get();
  return snapshot.docs
    .map((docSnapshot) => ({
      expressionId: docSnapshot.id,
      ...(docSnapshot.data() as SavedExpression),
    }))
    .sort((left, right) => {
      const createdAtDiff = left.createdAt.toMillis() - right.createdAt.toMillis();
      if (createdAtDiff !== 0) {
        return createdAtDiff;
      }
      return left.expressionId.localeCompare(right.expressionId);
    });
}

export async function createMaterialExpression(
  materialId: string,
  expression: Omit<SavedExpression, "createdAt" | "updatedAt">,
): Promise<SavedExpressionRecord | null> {
  const materialSnapshot = await getMaterialSnapshot(materialId);
  if (!materialSnapshot.exists) {
    return null;
  }

  const now = new Date();
  const collectionRef = materialSnapshot.ref.collection("expressions");
  const docRef = await collectionRef.add({
    ...expression,
    createdAt: now,
    updatedAt: now,
  });
  const savedSnapshot = await docRef.get();

  return {
    expressionId: savedSnapshot.id,
    ...(savedSnapshot.data() as SavedExpression),
  };
}

export async function deleteMaterialExpression(materialId: string, expressionId: string): Promise<boolean | null> {
  const materialSnapshot = await getMaterialSnapshot(materialId);
  if (!materialSnapshot.exists) {
    return null;
  }

  const expressionRef = materialSnapshot.ref.collection("expressions").doc(expressionId);
  const expressionSnapshot = await expressionRef.get();
  if (!expressionSnapshot.exists) {
    return false;
  }

  await expressionRef.delete();
  return true;
}
