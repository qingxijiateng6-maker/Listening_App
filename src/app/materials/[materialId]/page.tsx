import { MaterialLearningScreen } from "@/components/materials/MaterialLearningScreen";

type Props = {
  params: Promise<{ materialId: string }>;
};

export default async function MaterialPage({ params }: Props) {
  const { materialId } = await params;

  return <MaterialLearningScreen materialId={materialId} />;
}
