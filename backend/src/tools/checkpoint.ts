/**
 * Checkpoint tools: save_checkpoint + restore_checkpoint
 *
 * Save/restore frame state for rollback during iteration.
 * Checkpoints are stored in-memory (per session) — not persisted to disk.
 * The plugin handles full node tree reconstruction on restore.
 */

import { z } from 'zod';
import type { Bridge } from '../bridge.js';
import type { SerializedNode } from '../../../shared/protocol.js';

// In-memory checkpoint store: label → serialized node tree
const checkpoints = new Map<string, { frameId: string; data: SerializedNode; savedAt: string }>();

export const saveCheckpointSchema = z.object({
  frameId: z.string().describe('Frame ID to checkpoint'),
  label: z.string().describe('Label for this checkpoint (e.g., "pre-iteration", "after-typography")'),
});

export type SaveCheckpointInput = z.infer<typeof saveCheckpointSchema>;

export async function saveCheckpoint(input: SaveCheckpointInput, bridge: Bridge): Promise<any> {
  const { frameId, label } = input;

  // Serialize the frame tree from Figma
  const serialized = await bridge.sendCommand({
    type: 'serialize_frame',
    frameId,
  });

  if (!serialized || !serialized.id) {
    throw new Error(`Failed to serialize frame ${frameId}`);
  }

  // Store in memory
  checkpoints.set(label, {
    frameId,
    data: serialized as SerializedNode,
    savedAt: new Date().toISOString(),
  });

  // Count nodes in the tree
  function countNodes(node: SerializedNode): number {
    let count = 1;
    if (node.children) {
      for (const child of node.children) {
        count += countNodes(child);
      }
    }
    return count;
  }

  const nodeCount = countNodes(serialized as SerializedNode);

  return {
    message: `Checkpoint "${label}" saved (${nodeCount} nodes)`,
    label,
    frameId,
    nodeCount,
    availableCheckpoints: Array.from(checkpoints.keys()),
  };
}

export const restoreCheckpointSchema = z.object({
  label: z.string().describe('Label of the checkpoint to restore'),
});

export type RestoreCheckpointInput = z.infer<typeof restoreCheckpointSchema>;

export async function restoreCheckpoint(input: RestoreCheckpointInput, bridge: Bridge): Promise<any> {
  const { label } = input;

  const checkpoint = checkpoints.get(label);
  if (!checkpoint) {
    const available = Array.from(checkpoints.keys());
    throw new Error(
      `Checkpoint "${label}" not found. Available: ${available.length > 0 ? available.join(', ') : 'none'}`
    );
  }

  // Send restore command to plugin
  const result = await bridge.sendCommand({
    type: 'restore_checkpoint',
    frameId: checkpoint.frameId,
    serialized: checkpoint.data,
  });

  return {
    message: `Restored checkpoint "${label}" to frame ${checkpoint.frameId}`,
    label,
    frameId: checkpoint.frameId,
    savedAt: checkpoint.savedAt,
    result,
  };
}

export const listCheckpointsSchema = z.object({});

export type ListCheckpointsInput = z.infer<typeof listCheckpointsSchema>;

export async function listCheckpoints(_input: ListCheckpointsInput): Promise<any> {
  const list = Array.from(checkpoints.entries()).map(([label, cp]) => ({
    label,
    frameId: cp.frameId,
    savedAt: cp.savedAt,
  }));

  return {
    checkpoints: list,
    count: list.length,
  };
}

/**
 * Clear all checkpoints (called on session reset)
 */
export function clearCheckpoints(): void {
  checkpoints.clear();
}
