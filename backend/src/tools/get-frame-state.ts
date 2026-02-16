/**
 * get_frame_state tool
 *
 * Inspects the current state of a frame and its children.
 * Returns serialized structure for agent inspection.
 */

import { z } from 'zod';
import type { Bridge } from '../bridge.js';

export const getFrameStateSchema = z.object({
  frameId: z.string().describe('Frame ID to inspect'),
  depth: z.number().optional().describe('Recursion depth for children (default: 3)'),
  mode: z
    .enum(['full', 'summary'])
    .optional()
    .describe('Output mode: full = raw JSON, summary = compact text (default: summary)'),
});

export type GetFrameStateInput = z.infer<typeof getFrameStateSchema>;

/**
 * Recursively format a node into compact human-readable text
 */
function summarizeNode(node: any, indent: number = 0): string {
  const prefix = '  '.repeat(indent);
  let line = `${prefix}${node.type} "${node.name}"`;

  // Add relevant properties based on node type
  if (node.width && node.height) {
    line += ` (${Math.round(node.width)}x${Math.round(node.height)})`;
  }

  if (node.type === 'TEXT') {
    if (node.fontSize) line += ` (fontSize: ${node.fontSize})`;
    if (node.fontColor) {
      const c = node.fontColor;
      const hex = `#${Math.round(c.r * 255)
        .toString(16)
        .padStart(2, '0')}${Math.round(c.g * 255)
        .toString(16)
        .padStart(2, '0')}${Math.round(c.b * 255)
        .toString(16)
        .padStart(2, '0')}`;
      line += ` (color: ${hex})`;
    }
  }

  if (node.x !== undefined && node.y !== undefined) {
    line += ` (pos: ${Math.round(node.x)},${Math.round(node.y)})`;
  }

  let result = line;

  if (node.children && node.children.length > 0) {
    for (const child of node.children) {
      result += '\n' + summarizeNode(child, indent + 1);
    }
  }

  return result;
}

export async function getFrameState(input: GetFrameStateInput, bridge: Bridge): Promise<any> {
  const depth = input.depth || 3;
  const mode = input.mode || 'summary';

  const result = await bridge.sendCommand({
    type: 'serialize_frame',
    frameId: input.frameId,
  });

  if (mode === 'full') {
    // Return raw JSON structure
    return {
      frameId: input.frameId,
      structure: result,
      message: `Frame state retrieved (depth: ${depth}, mode: full)`,
    };
  } else {
    // Return compact summary
    const summary = summarizeNode(result);
    return {
      frameId: input.frameId,
      summary,
      message: `Frame state summary:\n${summary}`,
    };
  }
}
