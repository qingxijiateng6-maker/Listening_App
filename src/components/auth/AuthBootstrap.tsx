"use client";

import { useEffect, useState } from "react";
import { signInAnonymouslyIfNeeded, subscribeAuthState } from "@/lib/firebase/auth";

export function AuthBootstrap() {
  const [uid, setUid] = useState<string>("");

  useEffect(() => {
    const unsubscribe = subscribeAuthState((user) => {
      setUid(user?.uid ?? "");
    });

    void signInAnonymouslyIfNeeded();
    return unsubscribe;
  }, []);

  return (
    <section>
      <h1>Listening App Scaffold</h1>
      <p>Firebase Anonymous Auth: {uid ? "initialized" : "initializing..."}</p>
      {uid ? <p>UID: {uid}</p> : null}
    </section>
  );
}
