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

type StoredMaterialRecord = Material & {
  ownerUid: string;
};

async function getOwnedMaterialSnapshot(ownerUid: string, materialId: string) {
  const snapshot = await getAdminDb().collection("materials").doc(materialId).get();
  if (!snapshot.exists) {
    return null;
  }

  const material = snapshot.data() as Partial<StoredMaterialRecord>;
  if (material.ownerUid !== ownerUid) {
    return null;
  }

  return snapshot;
}

export async function getMaterial(ownerUid: string, materialId: string): Promise<MaterialRecord | null> {
  const snapshot = await getOwnedMaterialSnapshot(ownerUid, materialId);
  if (!snapshot) {
    return null;
  }

  return {
    materialId: snapshot.id,
    ...(snapshot.data() as Material),
  };
}

export async function listMaterialSegments(ownerUid: string, materialId: string): Promise<SegmentRecord[] | null> {
  const materialSnapshot = await getOwnedMaterialSnapshot(ownerUid, materialId);
  if (!materialSnapshot) {
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

export async function listMaterialExpressions(ownerUid: string, materialId: string): Promise<SavedExpressionRecord[] | null> {
  const materialSnapshot = await getOwnedMaterialSnapshot(ownerUid, materialId);
  if (!materialSnapshot) {
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
  ownerUid: string,
  materialId: string,
  expression: Omit<SavedExpression, "createdAt" | "updatedAt">,
): Promise<SavedExpressionRecord | null> {
  const materialSnapshot = await getOwnedMaterialSnapshot(ownerUid, materialId);
  if (!materialSnapshot) {
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

export async function deleteMaterialExpression(
  ownerUid: string,
  materialId: string,
  expressionId: string,
): Promise<boolean | null> {
  const materialSnapshot = await getOwnedMaterialSnapshot(ownerUid, materialId);
  if (!materialSnapshot) {
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

export async function deleteMaterial(ownerUid: string, materialId: string): Promise<boolean | null> {
  const materialSnapshot = await getOwnedMaterialSnapshot(ownerUid, materialId);
  if (!materialSnapshot) {
    return null;
  }

  const subcollectionNames = ["expressions", "segments"];

  await Promise.all(
    subcollectionNames.map(async (subcollectionName) => {
      const snapshot = await materialSnapshot.ref.collection(subcollectionName).get();
      if (snapshot.empty) {
        return;
      }

      const batch = getAdminDb().batch();
      snapshot.docs.forEach((docSnapshot) => {
        batch.delete(docSnapshot.ref);
      });
      await batch.commit();
    }),
  );

  await materialSnapshot.ref.delete();
  return true;
}
