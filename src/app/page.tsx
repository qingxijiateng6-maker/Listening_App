import { HistoryNavigation } from "@/components/materials/HistoryNavigation";
import { VideoRegistrationForm } from "@/components/materials/VideoRegistrationForm";

export default function Home() {
  return (
    <main className="homePage">
      <section className="homeHeroSection">
        <VideoRegistrationForm />
      </section>
      <HistoryNavigation />
    </main>
  );
}
