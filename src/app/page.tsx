import { AuthBootstrap } from "@/components/auth/AuthBootstrap";
import { FirestoreBootstrap } from "@/components/firebase/FirestoreBootstrap";
import { VideoRegistrationForm } from "@/components/materials/VideoRegistrationForm";

export default function Home() {
  return (
    <main>
      <AuthBootstrap />
      <FirestoreBootstrap />
      <VideoRegistrationForm />
    </main>
  );
}
