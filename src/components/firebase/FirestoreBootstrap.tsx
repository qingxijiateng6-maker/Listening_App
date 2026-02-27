"use client";

import { useEffect, useState } from "react";
import { getDb, materialsCollection } from "@/lib/firebase/firestore";

export function FirestoreBootstrap() {
  const [status, setStatus] = useState<"initializing" | "ready" | "error">("initializing");
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    try {
      const db = getDb();
      const materialsRef = materialsCollection();
      setStatus("ready");
      setMessage(`db=${db.app.name}, path=${materialsRef.path}`);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Failed to initialize Firestore");
    }
  }, []);

  return (
    <section>
      <p>Firestore: {status}</p>
      {message ? <p>{message}</p> : null}
    </section>
  );
}
