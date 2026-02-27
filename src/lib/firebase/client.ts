import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";

type FirebaseClientConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
};

function getFirebaseClientConfig(): FirebaseClientConfig {
  const envByConfigKey: Record<keyof FirebaseClientConfig, { env: string; value: string }> = {
    apiKey: {
      env: "NEXT_PUBLIC_FIREBASE_API_KEY",
      value: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
    },
    authDomain: {
      env: "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
      value: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
    },
    projectId: {
      env: "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
      value: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
    },
    storageBucket: {
      env: "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
      value: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
    },
    messagingSenderId: {
      env: "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
      value: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
    },
    appId: {
      env: "NEXT_PUBLIC_FIREBASE_APP_ID",
      value: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
    },
  };

  const config: FirebaseClientConfig = {
    apiKey: envByConfigKey.apiKey.value,
    authDomain: envByConfigKey.authDomain.value,
    projectId: envByConfigKey.projectId.value,
    storageBucket: envByConfigKey.storageBucket.value,
    messagingSenderId: envByConfigKey.messagingSenderId.value,
    appId: envByConfigKey.appId.value,
  };

  const missingEnvVars = Object.values(envByConfigKey)
    .filter(({ value }) => value.length === 0)
    .map(({ env }) => env);

  if (missingEnvVars.length > 0) {
    throw new Error(
      `Missing Firebase env vars: ${missingEnvVars.join(
        ", ",
      )}. Set them in .env.local, then restart "npm run dev" (or rebuild before "npm start").`,
    );
  }

  return config;
}

export function getFirebaseApp(): FirebaseApp {
  if (getApps().length > 0) {
    return getApp();
  }
  return initializeApp(getFirebaseClientConfig());
}
