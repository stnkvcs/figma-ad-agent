/**
 * delete_node tool
 *
 * Remove a node from the canvas.
 */

import { z } from 'zod';
import type { Bridge } from '../bridge.js';

export const deleteNodeSchema = z.object({
  nodeId: z.string().describe('ID of the node to delete'),
});

export type DeleteNodeInput = z.infer<typeof deleteNodeSchema>;

export async function deleteNode(input: DeleteNodeInput, bridge: Bridge): Promise<any> {
  await bridge.sendCommand({
    type: 'figma_call',
    method: 'deleteNode',
    args: [input.nodeId],
  });

  return {
    message: `Deleted node ${input.nodeId}`,
  };
}
