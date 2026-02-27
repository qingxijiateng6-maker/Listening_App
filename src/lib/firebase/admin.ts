import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

type AdminConfig = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

function getAdminConfig(): AdminConfig {
  const projectId = process.env.FIREBASE_PROJECT_ID ?? "";
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL ?? "";
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n");

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
