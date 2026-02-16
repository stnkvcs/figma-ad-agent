/**
 * export_ad tool
 *
 * Export a frame as a final PNG to disk.
 */

import { z } from 'zod';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { homedir } from 'os';
import type { Bridge } from '../bridge.js';

export const exportAdSchema = z.object({
  frameId: z.string().describe('Frame ID to export'),
  outputPath: z.string().describe('Absolute file path for the exported PNG'),
  scale: z.number().optional().describe('Export scale. Default: 2 (2x for high-res)'),
});

export type ExportAdInput = z.infer<typeof exportAdSchema>;

export async function exportAd(input: ExportAdInput, bridge: Bridge): Promise<any> {
  const scale = input.scale || 2;

  // Resolve ~ to home directory
  const outputPath = input.outputPath.startsWith('~')
    ? resolve(homedir(), input.outputPath.slice(2))
    : input.outputPath;

  // Export node as PNG
  const result = await bridge.sendCommand({
    type: 'export_node',
    nodeId: input.frameId,
    format: 'PNG',
    scale,
  });

  // Ensure output directory exists
  mkdirSync(dirname(outputPath), { recursive: true });

  // Write to disk
  writeFileSync(outputPath, Buffer.from(result.base64, 'base64'));

  return {
    outputPath,
    message: `Exported to ${outputPath} (${scale}x scale)`,
  };
}
