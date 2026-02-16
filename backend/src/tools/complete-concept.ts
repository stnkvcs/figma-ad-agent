/**
 * complete_concept tool
 *
 * Logs a completed ad concept to the brand's concepts-log and angle index.
 * Called after an ad is finalized — records L1/L2/L3 and metadata for variety tracking.
 */

import { z } from 'zod/v4';
import { appendConceptEntry } from '../data/concepts-log.js';
import { updateAngleIndex } from '../data/angle-index.js';
import { addConceptSummary } from '../session-persistence.js';
import { getSessionId, getSessionState } from '../session-state.js';

export const completeConceptSchema = z.object({
  brand: z.string().describe('Brand name'),
  angle: z.string().describe('L1: The insight/tension driving this concept'),
  formatCategory: z.string().describe('L2: Format category (Editorial, Comparison, Borrowed Interface, etc.)'),
  execution: z.string().describe('L3: Brief description of the visual treatment'),
  productPosition: z.string().optional().describe('Where product sits in frame (center-bottom, left, right, etc.)'),
  productShot: z.string().optional().describe('Type of product shot (static, hand-held, angled, etc.)'),
  background: z.string().optional().describe('Background treatment (solid, gradient, image, etc.)'),
  reference: z.string().optional().describe('Ad library reference path if used'),
  frameId: z.string().describe('Figma frame ID of the completed ad'),
});

export type CompleteConceptInput = z.infer<typeof completeConceptSchema>;

export async function completeConcept(input: CompleteConceptInput): Promise<any> {
  const date = new Date().toISOString().split('T')[0];

  // 1. Append to concepts-log.md
  appendConceptEntry(input.brand, {
    angle: input.angle,
    formatCategory: input.formatCategory,
    execution: input.execution,
    productPosition: input.productPosition,
    productShot: input.productShot,
    background: input.background,
    reference: input.reference,
    date,
  });

  // 2. Update angle index
  updateAngleIndex(input.brand, input.angle, {
    formatCategory: input.formatCategory,
    title: input.angle,
    description: input.execution,
  });

  // 3. Update session persistence with concept summary
  try {
    const sessionId = getSessionId();
    const session = getSessionState();
    const conceptSummary = {
      angle: input.angle,
      formatCategory: input.formatCategory,
      execution: input.execution,
      frameId: input.frameId,
      keyDecisions: [] as string[],
      issues: [] as string[],
      cost: session?.totalCost ?? 0,
      completedAt: new Date().toISOString(),
    };

    addConceptSummary(sessionId, conceptSummary);

    // Also update in-memory concept summaries
    if (session) {
      session.conceptSummaries.push(conceptSummary);
    }
  } catch (error) {
    console.error('[CompleteConcept] Failed to update session:', error);
  }

  return {
    message: `Concept logged for ${input.brand}: "${input.angle}" (${input.formatCategory}) — frame ${input.frameId}`,
    date,
  };
}
