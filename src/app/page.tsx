import { AuthBootstrap } from "@/components/auth/AuthBootstrap";
import { FirestoreBootstrap } from "@/components/firebase/FirestoreBootstrap";

export default function Home() {
  return (
    <main>
      <AuthBootstrap />
      <FirestoreBootstrap />
    </main>
  );
}
