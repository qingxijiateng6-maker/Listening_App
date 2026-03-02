import { Suspense } from "react";
import { MaterialRegistrationLoadingScreen } from "@/components/materials/MaterialRegistrationLoadingScreen";

export default function MaterialLoadingPage() {
  return (
    <Suspense fallback={null}>
      <MaterialRegistrationLoadingScreen />
    </Suspense>
  );
}
