/**
 * create_shape tool
 *
 * Create decorative shapes (rectangles, ellipses).
 * Used for backgrounds, decorative elements, dividers.
 */

import { z } from 'zod';
import type { Bridge } from '../bridge.js';
import { hexToRgb } from './utils.js';

export const createShapeSchema = z.object({
  parentId: z.string().describe('Parent frame ID'),
  shape: z.enum(['rectangle', 'ellipse']).describe('Shape type'),
  width: z.number().describe('Width in px'),
  height: z.number().describe('Height in px'),
  fillColor: z.string().optional().describe('Fill color hex (default: transparent)'),
  strokeColor: z.string().optional().describe('Stroke color hex'),
  strokeWeight: z.number().optional().describe('Stroke weight'),
  cornerRadius: z.number().optional().describe('Corner radius (rectangles only)'),
  opacity: z.number().optional().describe('Opacity 0-1'),
  name: z.string().optional().describe('Node name'),
  x: z.number().optional().describe('X position (for absolute positioning)'),
  y: z.number().optional().describe('Y position (for absolute positioning)'),
  absolutePosition: z.boolean().optional().describe('Use absolute positioning inside auto-layout parent. Default: false'),
  insertIndex: z.number().optional().describe('Z-order index. 0 = behind all siblings (bottom layer), higher = in front. Omit to add on top of all siblings (default).'),
});

export type CreateShapeInput = z.infer<typeof createShapeSchema>;

export async function createShape(input: CreateShapeInput, bridge: Bridge): Promise<any> {
  // Map shape to method
  const methodMap: Record<string, string> = {
    rectangle: 'createRectangle',
    ellipse: 'createEllipse',
  };

  const method = methodMap[input.shape];

  // Build options
  const opts: any = {
    parentId: input.parentId,
    width: input.width,
    height: input.height,
    name: input.name || input.shape.charAt(0).toUpperCase() + input.shape.slice(1),
  };

  // Fill color
  if (input.fillColor) {
    opts.fills = [{ type: 'SOLID', color: hexToRgb(input.fillColor) }];
  } else {
    opts.fills = []; // transparent by default
  }

  // Stroke
  if (input.strokeColor) {
    opts.strokes = [{ type: 'SOLID', color: hexToRgb(input.strokeColor) }];
  }
  if (input.strokeWeight !== undefined) {
    opts.strokeWeight = input.strokeWeight;
  }

  // Corner radius (rectangles only)
  if (input.shape === 'rectangle' && input.cornerRadius !== undefined) {
    opts.cornerRadius = input.cornerRadius;
  }

  // Opacity
  if (input.opacity !== undefined) {
    opts.opacity = input.opacity;
  }

  // Absolute positioning
  if (input.absolutePosition) {
    opts.layoutPositioning = 'ABSOLUTE';
    if (input.x !== undefined) opts.x = input.x;
    if (input.y !== undefined) opts.y = input.y;
  }

  // Z-order control
  if (input.insertIndex !== undefined) {
    opts.insertIndex = input.insertIndex;
  }

  // Create shape
  const result = await bridge.sendCommand({
    type: 'figma_call',
    method,
    args: [opts],
  });

  return {
    nodeId: result.id,
    message: `Created ${input.shape} (${input.width}x${input.height}px)`,
  };
}
