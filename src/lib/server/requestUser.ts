import { NextRequest } from "next/server";

export type RequestUser = {
  uid: string;
  source: "anonymous-header" | "firebase-id-token";
};

function readBearerToken(request: NextRequest): string {
  const authHeader = request.headers.get("authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return "";
  }
  return authHeader.slice("bearer ".length).trim();
}

async function resolveFirebaseIdTokenUser(request: NextRequest): Promise<RequestUser | null> {
  const idToken = readBearerToken(request);
  if (!idToken) {
    return null;
  }

  // Placeholder for Firebase Admin ID token verification.
  return null;
}

function resolveAnonymousHeaderUser(request: NextRequest): RequestUser | null {
  const uid = request.headers.get("x-user-id")?.trim() ?? "";
  if (!uid) {
    return null;
  }

  return {
    uid,
    source: "anonymous-header",
  };
}

export async function resolveRequestUser(request: NextRequest): Promise<RequestUser | null> {
  return (await resolveFirebaseIdTokenUser(request)) ?? resolveAnonymousHeaderUser(request);
}
