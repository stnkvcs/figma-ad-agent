/**
 * update_node tool
 *
 * Universal property modifier for existing nodes.
 * Used for iteration — moving, resizing, recoloring, adjusting layout.
 */

import { z } from 'zod';
import type { Bridge } from '../bridge.js';
import { hexToRgb, hexToRgba } from './utils.js';

export const updateNodeSchema = z.object({
  nodeId: z.string().describe('ID of the node to update'),
  properties: z.object({
    // Position & dimensions
    x: z.number().optional().describe('X position (ignored for auto-layout children unless layoutPositioning is ABSOLUTE)'),
    y: z.number().optional().describe('Y position (ignored for auto-layout children unless layoutPositioning is ABSOLUTE)'),
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
      .describe('How children align on the main axis (FRAME only). MIN=top/left, MAX=bottom/right, SPACE_BETWEEN=spread evenly'),
    counterAxisAlignItems: z.enum(['MIN', 'CENTER', 'MAX']).optional()
      .describe('How children align on the cross axis (FRAME only). MIN=left/top, CENTER=center, MAX=right/bottom. Use this to left-align children instead of setting x.'),
    clipsContent: z.boolean().optional().describe('Whether frame clips children outside its bounds'),
    // Layout sizing (any node inside auto-layout parent)
    layoutSizingHorizontal: z.enum(['FIXED', 'HUG', 'FILL']).optional()
      .describe('Horizontal sizing mode. FILL=stretch to parent width, HUG=shrink to content, FIXED=explicit width'),
    layoutSizingVertical: z.enum(['FIXED', 'HUG', 'FILL']).optional()
      .describe('Vertical sizing mode. FILL=stretch to parent height, HUG=shrink to content, FIXED=explicit height'),
    layoutPositioning: z.enum(['AUTO', 'ABSOLUTE']).optional()
      .describe('AUTO=participates in auto-layout flow, ABSOLUTE=positioned by x/y ignoring auto-layout. Set on CHILD node.'),
    // Text
    fontSize: z.number().optional().describe('Font size'),
    fontColor: z.string().optional().describe('Hex color for text'),
    characters: z.string().optional().describe('Replace text content'),
    textAlignHorizontal: z.enum(['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED']).optional().describe('Text horizontal alignment'),
    textAutoResize: z.enum(['NONE', 'WIDTH_AND_HEIGHT', 'HEIGHT']).optional().describe('Text auto-resize mode'),
  }).describe('Properties to update'),
});

export type UpdateNodeInput = z.infer<typeof updateNodeSchema>;

export async function updateNode(input: UpdateNodeInput, bridge: Bridge): Promise<any> {
  const props: any = {};
  const p = input.properties;

  // Position & dimensions
  if (p.x !== undefined) props.x = p.x;
  if (p.y !== undefined) props.y = p.y;
  if (p.width !== undefined) props.width = p.width;
  if (p.height !== undefined) props.height = p.height;
  if (p.rotation !== undefined) props.rotation = p.rotation;
  if (p.opacity !== undefined) props.opacity = p.opacity;
  if (p.visible !== undefined) props.visible = p.visible;
  if (p.name !== undefined) props.name = p.name;

  // Visual properties
  if (p.fillColor) {
    props.fills = [{ type: 'SOLID', color: hexToRgb(p.fillColor) }];
  }
  if (p.strokeColor) {
    props.strokes = [{ type: 'SOLID', color: hexToRgb(p.strokeColor) }];
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

  // Layout sizing (any node inside auto-layout parent)
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

  // Send update command
  await bridge.sendCommand({
    type: 'figma_call',
    method: 'updateNode',
    args: [input.nodeId, props],
  });

  // Build summary of changes
  const changes: string[] = [];
  if (p.x !== undefined || p.y !== undefined) changes.push('position');
  if (p.width !== undefined || p.height !== undefined) changes.push('size');
  if (p.fillColor || p.strokeColor || p.fontColor) changes.push('color');
  if (p.layoutMode !== undefined || p.primaryAxisAlignItems !== undefined || p.counterAxisAlignItems !== undefined) changes.push('alignment');
  if (p.layoutSizingHorizontal !== undefined || p.layoutSizingVertical !== undefined) changes.push('sizing');
  if (p.layoutPositioning !== undefined) changes.push('positioning');
  if (p.characters !== undefined) changes.push('text');
  if (p.textAlignHorizontal !== undefined || p.textAutoResize !== undefined) changes.push('text-layout');

  return {
    message: `Updated ${changes.length > 0 ? changes.join(', ') : 'properties'}`,
  };
}
