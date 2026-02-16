/**
 * batch_update tool
 *
 * Update multiple nodes in a single round-trip.
 * Reuses the same property conversion logic as update_node.
 * This is the #1 impact improvement from Phase 3b E2E — cuts 10+ sequential calls to 1.
 */

import { z } from 'zod';
import type { Bridge } from '../bridge.js';
import { hexToRgb, hexToRgba } from './utils.js';

// Shared property schema (same as update-node but extracted for reuse)
const nodePropertiesSchema = z.object({
  // Position & dimensions
  x: z.number().optional().describe('X position'),
  y: z.number().optional().describe('Y position'),
  width: z.number().optional().describe('Width in px'),
  height: z.number().optional().describe('Height in px'),
  rotation: z.number().optional().describe('Rotation in degrees'),
  opacity: z.number().optional().describe('Opacity 0-1'),
  visible: z.boolean().optional().describe('Visibility'),
  name: z.string().optional().describe('Node name'),
  // Visual
  fillColor: z.string().optional().describe('Hex color for solid fill'),
  strokeColor: z.string().optional().describe('Hex color for stroke'),
  strokeWeight: z.number().optional().describe('Stroke weight'),
  cornerRadius: z.number().optional().describe('Corner radius'),
  // Auto-layout (FRAME only)
  layoutMode: z.enum(['NONE', 'HORIZONTAL', 'VERTICAL']).optional().describe('Auto-layout mode'),
  itemSpacing: z.number().optional().describe('Gap between children'),
  paddingTop: z.number().optional().describe('Top padding'),
  paddingRight: z.number().optional().describe('Right padding'),
  paddingBottom: z.number().optional().describe('Bottom padding'),
  paddingLeft: z.number().optional().describe('Left padding'),
  primaryAxisAlignItems: z.enum(['MIN', 'CENTER', 'MAX', 'SPACE_BETWEEN']).optional()
    .describe('Main axis alignment (FRAME only)'),
  counterAxisAlignItems: z.enum(['MIN', 'CENTER', 'MAX']).optional()
    .describe('Cross axis alignment (FRAME only)'),
  clipsContent: z.boolean().optional().describe('Whether frame clips children'),
  // Layout sizing
  layoutSizingHorizontal: z.enum(['FIXED', 'HUG', 'FILL']).optional()
    .describe('Horizontal sizing mode'),
  layoutSizingVertical: z.enum(['FIXED', 'HUG', 'FILL']).optional()
    .describe('Vertical sizing mode'),
  layoutPositioning: z.enum(['AUTO', 'ABSOLUTE']).optional()
    .describe('AUTO or ABSOLUTE positioning'),
  // Text
  fontSize: z.number().optional().describe('Font size'),
  fontColor: z.string().optional().describe('Hex color for text'),
  characters: z.string().optional().describe('Replace text content'),
  textAlignHorizontal: z.enum(['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED']).optional().describe('Text alignment'),
  textAutoResize: z.enum(['NONE', 'WIDTH_AND_HEIGHT', 'HEIGHT']).optional().describe('Text auto-resize mode'),
});

export const batchUpdateSchema = z.object({
  updates: z.array(z.object({
    nodeId: z.string().describe('ID of the node to update'),
    properties: nodePropertiesSchema.describe('Properties to update on this node'),
  })).min(1).max(50).describe('Array of node updates (1-50). All updates execute in a single round-trip.'),
});

export type BatchUpdateInput = z.infer<typeof batchUpdateSchema>;

/**
 * Convert tool-level properties to Figma-ready properties.
 * Same logic as update-node.ts — extracted for reuse.
 * Exported for batch-operations.ts DSL handler.
 */
export function convertProperties(p: z.infer<typeof nodePropertiesSchema>): any {
  const props: any = {};

  // Position & dimensions
  if (p.x !== undefined) props.x = p.x;
  if (p.y !== undefined) props.y = p.y;
  if (p.width !== undefined) props.width = p.width;
  if (p.height !== undefined) props.height = p.height;
  if (p.rotation !== undefined) props.rotation = p.rotation;
  if (p.opacity !== undefined) props.opacity = p.opacity;
  if (p.visible !== undefined) props.visible = p.visible;
  if (p.name !== undefined) props.name = p.name;

  // Visual properties — support 8-char hex with alpha (e.g., #00000000 = transparent)
  if (p.fillColor) {
    const rgba = hexToRgba(p.fillColor);
    props.fills = [{ type: 'SOLID', color: { r: rgba.r, g: rgba.g, b: rgba.b }, opacity: rgba.a }];
  }
  if (p.strokeColor) {
    const rgba = hexToRgba(p.strokeColor);
    props.strokes = [{ type: 'SOLID', color: { r: rgba.r, g: rgba.g, b: rgba.b }, opacity: rgba.a }];
  }
  if (p.strokeWeight !== undefined) props.strokeWeight = p.strokeWeight;
  if (p.cornerRadius !== undefined) props.cornerRadius = p.cornerRadius;

  // Auto-layout (frame properties)
  if (p.layoutMode !== undefined) props.layoutMode = p.layoutMode;
  if (p.itemSpacing !== undefined) props.itemSpacing = p.itemSpacing;
  if (p.paddingTop !== undefined) props.paddingTop = p.paddingTop;
  if (p.paddingRight !== undefined) props.paddingRight = p.paddingRight;
  if (p.paddingBottom !== undefined) props.paddingBottom = p.paddingBottom;
  if (p.paddingLeft !== undefined) props.paddingLeft = p.paddingLeft;
  if (p.primaryAxisAlignItems !== undefined) props.primaryAxisAlignItems = p.primaryAxisAlignItems;
  if (p.counterAxisAlignItems !== undefined) props.counterAxisAlignItems = p.counterAxisAlignItems;
  if (p.clipsContent !== undefined) props.clipsContent = p.clipsContent;

  // Layout sizing
  if (p.layoutSizingHorizontal !== undefined) props.layoutSizingHorizontal = p.layoutSizingHorizontal;
  if (p.layoutSizingVertical !== undefined) props.layoutSizingVertical = p.layoutSizingVertical;
  if (p.layoutPositioning !== undefined) props.layoutPositioning = p.layoutPositioning;

  // Text properties
  if (p.fontSize !== undefined) props.fontSize = p.fontSize;
  if (p.fontColor) {
    props.fills = [{ type: 'SOLID', color: hexToRgb(p.fontColor) }];
  }
  if (p.characters !== undefined) props.characters = p.characters;
  if (p.textAlignHorizontal !== undefined) props.textAlignHorizontal = p.textAlignHorizontal;
  if (p.textAutoResize !== undefined) props.textAutoResize = p.textAutoResize;

  return props;
}

export async function batchUpdate(input: BatchUpdateInput, bridge: Bridge): Promise<any> {
  // Convert all updates to Figma-ready format
  const figmaUpdates = input.updates.map(u => ({
    nodeId: u.nodeId,
    properties: convertProperties(u.properties),
  }));

  // Send as a single batch_update command
  const result = await bridge.sendCommand({
    type: 'batch_update',
    updates: figmaUpdates,
  });

  // Build summary
  const summaryParts: string[] = [];
  for (const u of input.updates) {
    const changes: string[] = [];
    const p = u.properties;
    if (p.x !== undefined || p.y !== undefined) changes.push('position');
    if (p.width !== undefined || p.height !== undefined) changes.push('size');
    if (p.fillColor || p.strokeColor || p.fontColor) changes.push('color');
    if (p.layoutMode !== undefined || p.primaryAxisAlignItems !== undefined || p.counterAxisAlignItems !== undefined) changes.push('alignment');
    if (p.layoutSizingHorizontal !== undefined || p.layoutSizingVertical !== undefined) changes.push('sizing');
    if (p.layoutPositioning !== undefined) changes.push('positioning');
    if (p.characters !== undefined) changes.push('text');
    if (p.textAlignHorizontal !== undefined || p.textAutoResize !== undefined) changes.push('text-layout');
    if (p.opacity !== undefined) changes.push('opacity');
    if (p.name !== undefined) changes.push('name');
    summaryParts.push(`${u.nodeId}: ${changes.join(', ') || 'properties'}`);
  }

  return {
    message: `Batch updated ${input.updates.length} nodes`,
    updates: summaryParts,
    errors: result.errors || [],
  };
}
