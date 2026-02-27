import {
  collection,
  doc,
  getFirestore,
  serverTimestamp,
  type CollectionReference,
  type DocumentReference,
  type FieldValue,
} from "firebase/firestore";
import { getFirebaseApp } from "@/lib/firebase/client";
import type { Expression, Glossary, Job, Material, Segment, UserExpression } from "@/types/domain";

export function getDb() {
  return getFirestore(getFirebaseApp());
}

export function nowTimestamp(): FieldValue {
  return serverTimestamp();
}

export function materialsCollection(): CollectionReference<Material> {
  return collection(getDb(), "materials") as CollectionReference<Material>;
}

export function materialDoc(materialId: string): DocumentReference<Material> {
  return doc(getDb(), "materials", materialId) as DocumentReference<Material>;
}

export function segmentsCollection(materialId: string): CollectionReference<Segment> {
  return collection(getDb(), "materials", materialId, "segments") as CollectionReference<Segment>;
}

export function expressionsCollection(materialId: string): CollectionReference<Expression> {
  return collection(getDb(), "materials", materialId, "expressions") as CollectionReference<Expression>;
}

export function glossaryCollection(materialId: string): CollectionReference<Glossary> {
  return collection(getDb(), "materials", materialId, "glossary") as CollectionReference<Glossary>;
}

export function jobsCollection(): CollectionReference<Job> {
  return collection(getDb(), "jobs") as CollectionReference<Job>;
}

export function userExpressionsCollection(uid: string): CollectionReference<UserExpression> {
  return collection(getDb(), "users", uid, "expressions") as CollectionReference<UserExpression>;
}
