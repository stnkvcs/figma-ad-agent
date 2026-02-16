/**
 * get_canvas_screenshot tool
 *
 * Captures a screenshot of a node as an image for visual inspection.
 * Returns as MCP image content block so the agent can SEE it via vision.
 * Also saves to disk for critic subagent access and session history.
 */

import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import type { Bridge } from '../bridge.js';
import { getAssetOutputDir } from '../session-state.js';

const FALLBACK_SCREENSHOT_DIR = path.join(process.cwd(), 'data', 'screenshots');

export const getCanvasScreenshotSchema = z.object({
  nodeId: z.string().describe('Node ID to screenshot'),
  quality: z
    .enum(['draft', 'final'])
    .optional()
    .describe('Screenshot quality: draft = 0.5x JPG (fast), final = 1x PNG (slow)'),
});

export type GetCanvasScreenshotInput = z.infer<typeof getCanvasScreenshotSchema>;

export async function getCanvasScreenshot(input: GetCanvasScreenshotInput, bridge: Bridge): Promise<any> {
  const quality = input.quality || 'draft';
  const format = quality === 'final' ? 'PNG' : 'JPG';
  const scale = quality === 'final' ? 1 : 0.5;

  const result = await bridge.sendCommand({
    type: 'export_node',
    nodeId: input.nodeId,
    format,
    scale,
  });

  if (!result.base64) {
    throw new Error('Screenshot export failed: no base64 data returned');
  }

  const mimeType = quality === 'final' ? 'image/png' : 'image/jpeg';
  const ext = quality === 'final' ? 'png' : 'jpg';

  // Save screenshot to disk
  let savedPath: string | null = null;
  try {
    let outputDir: string;
    try {
      outputDir = getAssetOutputDir();
    } catch {
      // No active session — use fallback directory
      outputDir = FALLBACK_SCREENSHOT_DIR;
    }
    fs.mkdirSync(outputDir, { recursive: true });

    const timestamp = Date.now();
    const filename = `screenshot-${timestamp}.${ext}`;
    savedPath = path.join(outputDir, filename);

    const buffer = Buffer.from(result.base64, 'base64');
    fs.writeFileSync(savedPath, buffer);
  } catch (err) {
    // Non-fatal — log but don't fail the tool
    console.warn('[Screenshot] Failed to save to disk:', err);
  }

  // Return image content block for vision + file path as text
  const content: any[] = [
    {
      type: 'image',
      data: result.base64,
      mimeType,
    },
  ];

  if (savedPath) {
    content.push({
      type: 'text',
      text: JSON.stringify({ filePath: savedPath, nodeId: input.nodeId }),
    });
  }

  return { content };
}
