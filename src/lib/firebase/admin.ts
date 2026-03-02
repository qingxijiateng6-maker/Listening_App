import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

type AdminConfig = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

function normalizeEnvValue(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function normalizePemFormatting(value: string): string {
  const match = value.match(
    /-----BEGIN ([A-Z ]+)-----\s*([\s\S]*?)\s*-----END \1-----/,
  );

  if (!match) {
    return value;
  }

  const label = match[1];
  const body = match[2].replace(/\s+/g, "");
  if (!body) {
    return value;
  }

  const wrappedBody = body.match(/.{1,64}/g)?.join("\n") ?? body;
  return `-----BEGIN ${label}-----\n${wrappedBody}\n-----END ${label}-----\n`;
}

export function normalizeFirebasePrivateKey(value: string | undefined): string {
  return normalizePemFormatting(
    normalizeEnvValue(value)
    .replace(/\r\n/g, "\n")
    .replace(/\\n/g, "\n"),
  );
}

function getAdminConfig(): AdminConfig {
  const projectId = normalizeEnvValue(process.env.FIREBASE_PROJECT_ID);
  const clientEmail = normalizeEnvValue(process.env.FIREBASE_CLIENT_EMAIL);
  const privateKey = normalizeFirebasePrivateKey(process.env.FIREBASE_PRIVATE_KEY);

  const missing = [
    ["FIREBASE_PROJECT_ID", projectId],
    ["FIREBASE_CLIENT_EMAIL", clientEmail],
    ["FIREBASE_PRIVATE_KEY", privateKey],
  ]
    .filter(([, value]) => value.length === 0)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`Missing Firebase Admin env vars: ${missing.join(", ")}`);
  }

  return { projectId, clientEmail, privateKey };
}

function getAdminApp(): App {
  if (getApps().length > 0) {
    return getApps()[0]!;
  }

  const config = getAdminConfig();
  return initializeApp({
    credential: cert({
      projectId: config.projectId,
      clientEmail: config.clientEmail,
      privateKey: config.privateKey,
    }),
  });
}

export function getAdminDb() {
  return getFirestore(getAdminApp());
}

export function getAdminAuth() {
  return getAuth(getAdminApp());
}
