import { Timestamp, type Timestamp as AdminTimestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import type { UserExpressionStatus } from "@/types/domain";

type StoredUserExpression = {
  status: UserExpressionStatus;
  updatedAt: AdminTimestamp;
};

export type UserExpressionRecord = {
  expressionId: string;
  status: UserExpressionStatus;
  updatedAt: string;
};

export function isUserExpressionStatus(value: unknown): value is UserExpressionStatus {
  return value === "saved" || value === "ignored" || value === "mastered";
}

export async function listUserExpressions(uid: string): Promise<UserExpressionRecord[]> {
  const snapshot = await getAdminDb().collection("users").doc(uid).collection("expressions").get();

  return snapshot.docs
    .map((docSnapshot) => ({
      expressionId: docSnapshot.id,
      ...(docSnapshot.data() as StoredUserExpression),
    }))
    .sort((left, right) => right.updatedAt.toMillis() - left.updatedAt.toMillis())
    .map((record) => ({
      expressionId: record.expressionId,
      status: record.status,
      updatedAt: record.updatedAt.toDate().toISOString(),
    }));
}

export async function upsertUserExpression(
  uid: string,
  expressionId: string,
  status: UserExpressionStatus,
): Promise<UserExpressionRecord> {
  const updatedAt = Timestamp.now();
  const record: StoredUserExpression = {
    status,
    updatedAt,
  };

  await getAdminDb().collection("users").doc(uid).collection("expressions").doc(expressionId).set(record, {
    merge: true,
  });

  return {
    expressionId,
    status,
    updatedAt: updatedAt.toDate().toISOString(),
  };
}
