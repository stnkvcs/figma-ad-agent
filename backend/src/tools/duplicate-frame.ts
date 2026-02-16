/**
 * duplicate_frame tool
 *
 * Duplicate an existing frame. Used for concept variations.
 */

import { z } from 'zod';
import type { Bridge } from '../bridge.js';

export const duplicateFrameSchema = z.object({
  frameId: z.string().describe('ID of the frame to duplicate'),
  newName: z.string().optional().describe('Name for the duplicate'),
  offsetX: z.number().optional().describe('Horizontal offset from original. Default: original width + 100'),
});

export type DuplicateFrameInput = z.infer<typeof duplicateFrameSchema>;

export async function duplicateFrame(input: DuplicateFrameInput, bridge: Bridge): Promise<any> {
  // Get original frame info
  const originalInfo = await bridge.sendCommand({
    type: 'figma_call',
    method: 'getNodeById',
    args: [input.frameId],
  });

  // Clone the node
  const cloneResult = await bridge.sendCommand({
    type: 'figma_call',
    method: 'cloneNode',
    args: [input.frameId],
  });

  const cloneId = cloneResult.id;

  // Calculate offset (default: original width + 100px spacing)
  const offsetX = input.offsetX ?? (originalInfo.width + 100);
  const newX = originalInfo.x + offsetX;
  const newName = input.newName || `${originalInfo.name} (Copy)`;

  // Update position and name
  await bridge.sendCommand({
    type: 'figma_call',
    method: 'updateNode',
    args: [cloneId, {
      x: newX,
      name: newName,
    }],
  });

  return {
    duplicateId: cloneId,
    message: `Duplicated frame → ${newName} (offset: +${Math.round(offsetX)}px)`,
  };
}
