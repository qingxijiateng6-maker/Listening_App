import { MaterialLearningScreen } from "@/components/materials/MaterialLearningScreen";

type Props = {
  params: { materialId: string };
};

export default function MaterialPage({ params }: Props) {
  return <MaterialLearningScreen materialId={params.materialId} />;
}
