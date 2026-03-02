import { HistoryNavigation } from "@/components/materials/HistoryNavigation";
import { VideoRegistrationForm } from "@/components/materials/VideoRegistrationForm";

export default function Home() {
  return (
    <main className="homePage">
      <section className="homeHeroSection">
        <VideoRegistrationForm />
      </section>
      <HistoryNavigation />
      <section className="homeAppDescriptionSection" aria-labelledby="app-description-heading">
        <p id="app-description-heading" className="homeAppDescriptionLabel">
          このアプリの説明↓
        </p>
        <a
          className="homeAppDescriptionLink"
          href="https://peppered-chicory-bac.notion.site/3172738ccd0f80f795b7eaa1663c11fa?pvs=143"
          target="_blank"
          rel="noreferrer"
        >
          https://peppered-chicory-bac.notion.site/3172738ccd0f80f795b7eaa1663c11fa?pvs=143
        </a>
      </section>
    </main>
  );
}
