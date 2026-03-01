import { getAdminDb } from "@/lib/firebase/admin";
import type { Expression, Material, Segment } from "@/types/domain";

const MAX_EXPRESSION_RESULTS = 20;
const GENERIC_SCENARIO_EXAMPLE_PATTERN = /^In a meeting, I used "(.+)" to explain my point clearly\.$/;

export type MaterialRecord = Material & {
  materialId: string;
};

export type SegmentRecord = Segment & {
  segmentId: string;
};

export type ExpressionRecord = Expression & {
  expressionId: string;
};

function normalizeExpressionExample(
  expression: ExpressionRecord,
  segmentTextById: Map<string, string>,
): ExpressionRecord {
  if (!GENERIC_SCENARIO_EXAMPLE_PATTERN.test(expression.scenarioExample)) {
    return expression;
  }

  const firstOccurrence = expression.occurrences[0];
  const segmentText = firstOccurrence ? segmentTextById.get(firstOccurrence.segmentId) : "";
  if (!segmentText) {
    return expression;
  }

  return {
    ...expression,
    scenarioExample: segmentText,
  };
}

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

  const [expressionSnapshot, segmentSnapshot] = await Promise.all([
    materialSnapshot.ref.collection("expressions").get(),
    materialSnapshot.ref.collection("segments").get(),
  ]);
  const segmentTextById = new Map(
    segmentSnapshot.docs.map((docSnapshot) => {
      const segment = docSnapshot.data() as Segment;
      return [docSnapshot.id, segment.text] as const;
    }),
  );

  return expressionSnapshot.docs
    .map((docSnapshot) => ({
      expressionId: docSnapshot.id,
      ...(docSnapshot.data() as Expression),
    }))
    .sort(
      (left, right) =>
        right.scoreFinal - left.scoreFinal ||
        right.createdAt.toMillis() - left.createdAt.toMillis() ||
        left.expressionId.localeCompare(right.expressionId),
    )
    .slice(0, MAX_EXPRESSION_RESULTS)
    .map((expression) => normalizeExpressionExample(expression, segmentTextById));
}
