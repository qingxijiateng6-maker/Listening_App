import { NextRequest } from "next/server";
import { getAdminAuth } from "@/lib/firebase/admin";

export type RequestUser = {
  uid: string;
  source: "firebase-id-token" | "x-user-id";
};

function readBearerToken(request: NextRequest): string {
  const authHeader = request.headers.get("authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return "";
  }
  return authHeader.slice("bearer ".length).trim();
}

function readHeaderFallbackUser(request: NextRequest): RequestUser | null {
  const uid = request.headers.get("x-user-id")?.trim() ?? "";
  if (!uid) {
    return null;
  }

  return {
    uid,
    source: "x-user-id",
  };
}

async function resolveFirebaseIdTokenUser(request: NextRequest): Promise<RequestUser | null> {
  const idToken = readBearerToken(request);
  if (!idToken) {
    return null;
  }

  try {
    const decodedToken = await getAdminAuth().verifyIdToken(idToken);
    return {
      uid: decodedToken.uid,
      source: "firebase-id-token",
    };
  } catch {
    return null;
  }
}

export async function resolveRequestUser(request: NextRequest): Promise<RequestUser | null> {
  const firebaseUser = await resolveFirebaseIdTokenUser(request);
  if (firebaseUser) {
    return firebaseUser;
  }

  return readHeaderFallbackUser(request);
}
