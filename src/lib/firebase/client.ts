import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";

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
    console.error("Missing Firebase env vars.", { missingEnvVars });
    throw new Error("Firebase設定が不足しています。");
  }

  return config;
}

type FirebaseAppState = {
  app: FirebaseApp | null;
  error: Error | null;
  initialized: boolean;
};

const firebaseAppState: FirebaseAppState = {
  app: null,
  error: null,
  initialized: false,
};

function initializeFirebaseApp(): FirebaseApp | null {
  try {
    if (getApps().length > 0) {
      return getApp();
    }

    return initializeApp(getFirebaseClientConfig());
  } catch (error) {
    const firebaseError =
      error instanceof Error ? error : new Error("Firebase初期化に失敗しました。");

    firebaseAppState.error = firebaseError;
    console.error("Failed to initialize Firebase client.", error);
    return null;
  }
}

export function getFirebaseApp(): FirebaseApp | null {
  if (!firebaseAppState.initialized) {
    firebaseAppState.app = initializeFirebaseApp();
    firebaseAppState.initialized = true;
  }

  return firebaseAppState.app;
}

export function getFirebaseClientError(): Error | null {
  if (!firebaseAppState.initialized) {
    getFirebaseApp();
  }

  return firebaseAppState.error;
}
