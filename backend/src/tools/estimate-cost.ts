/**
 * estimate_cost tool
 *
 * Per-concept cost estimation for fal.ai asset generation.
 * Called during ideation — agent presents estimate to user before building.
 */

import { z } from 'zod';

export const estimateCostSchema = z.object({
  numProductPhotos: z.number().optional().describe('Expected product photos to generate. Default: 1'),
  numAssets: z.number().optional().describe('Expected non-product assets (backgrounds, UI, props). Default: 0'),
  numBgRemovals: z.number().optional().describe('Expected background removals. Default: 0'),
});

export type EstimateCostInput = z.infer<typeof estimateCostSchema>;

// fal.ai cost per operation (approximate, USD)
const COSTS = {
  productPhoto2K: 0.12,
  productPhoto1K: 0.08,
  assetT2I_1K: 0.06,
  assetT2I_2K: 0.10,
  bgRemoval: 0.03,
  agentInferenceMin: 5.0,
  agentInferenceMax: 10.0,
  libraryAndScreenshots: { min: 0.70, max: 1.50 },
};

export async function estimateCost(input: EstimateCostInput): Promise<any> {
  const numProductPhotos = input.numProductPhotos ?? 1;
  const numAssets = input.numAssets ?? 0;
  const numBgRemovals = input.numBgRemovals ?? 0;

  const breakdown: Array<{ item: string; cost: number }> = [];

  if (numProductPhotos > 0) {
    const cost = numProductPhotos * COSTS.productPhoto2K;
    breakdown.push({ item: `${numProductPhotos}x product photo (2K)`, cost });
  }

  if (numAssets > 0) {
    const cost = numAssets * COSTS.assetT2I_1K;
    breakdown.push({ item: `${numAssets}x asset (1K)`, cost });
  }

  if (numBgRemovals > 0) {
    const cost = numBgRemovals * COSTS.bgRemoval;
    breakdown.push({ item: `${numBgRemovals}x background removal`, cost });
  }

  const assetGeneration = breakdown.reduce((sum, b) => sum + b.cost, 0);

  const totalMin = assetGeneration + COSTS.agentInferenceMin + COSTS.libraryAndScreenshots.min;
  const totalMax = assetGeneration + COSTS.agentInferenceMax + COSTS.libraryAndScreenshots.max;

  return {
    estimate: {
      assetGeneration: Math.round(assetGeneration * 100) / 100,
      agentInference: `$${COSTS.agentInferenceMin}-${COSTS.agentInferenceMax}`,
      libraryAndScreenshots: `$${COSTS.libraryAndScreenshots.min.toFixed(2)}-${COSTS.libraryAndScreenshots.max.toFixed(2)}`,
      totalRange: `$${totalMin.toFixed(2)}-${totalMax.toFixed(2)}`,
    },
    breakdown,
    message: `Estimated cost for this concept: $${totalMin.toFixed(2)}-${totalMax.toFixed(2)} (asset generation: $${assetGeneration.toFixed(2)}, agent: $${COSTS.agentInferenceMin}-${COSTS.agentInferenceMax}, library/screenshots: $${COSTS.libraryAndScreenshots.min.toFixed(2)}-${COSTS.libraryAndScreenshots.max.toFixed(2)})`,
  };
}
