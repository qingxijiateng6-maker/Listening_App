export function buildMaterialPipelineJobId(materialId: string, pipelineVersion: string): string {
  return `material_pipeline:${materialId}:${pipelineVersion}`;
}
