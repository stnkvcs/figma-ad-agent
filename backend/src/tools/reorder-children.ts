/**
 * reorder_children tool
 *
 * Reorder children of a frame to control z-order (layer stacking).
 * First childId = bottom/behind, last childId = top/front.
 */

import { z } from 'zod';
import type { Bridge } from '../bridge.js';

export const reorderChildrenSchema = z.object({
  parentId: z.string().describe('Parent frame ID whose children to reorder'),
  childIds: z.array(z.string()).describe('Child IDs in desired visual order: first = bottom/behind, last = top/front'),
});

export type ReorderChildrenInput = z.infer<typeof reorderChildrenSchema>;

export async function reorderChildren(input: ReorderChildrenInput, bridge: Bridge): Promise<any> {
  const { parentId, childIds } = input;

  // Reparent each child in order — appendChild moves it to the end (top)
  // So iterating in order: first child ends up at bottom, last at top
  for (let i = 0; i < childIds.length; i++) {
    await bridge.sendCommand({
      type: 'figma_call',
      method: 'appendChild',
      args: [parentId, childIds[i]],
    });
  }

  return {
    message: `Reordered ${childIds.length} children in frame. Bottom (behind): ${childIds[0]}, Top (front): ${childIds[childIds.length - 1]}`,
  };
}
