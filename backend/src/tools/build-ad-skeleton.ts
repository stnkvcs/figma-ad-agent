/**
 * build_ad_skeleton tool
 *
 * Creates the root frame for an ad with proper dimensions, auto-layout, and safe zones.
 */

import { z } from 'zod';
import type { Bridge } from '../bridge.js';

export const buildAdSkeletonSchema = z.object({
  format: z.enum(['story', 'feed', 'custom']).describe('Ad format: story (9:16), feed (1:1), or custom'),
  width: z.number().optional().describe('Custom width (only for custom format)'),
  height: z.number().optional().describe('Custom height (only for custom format)'),
  name: z.string().optional().describe('Frame name (default: "Ad Frame")'),
  backgroundColor: z.string().optional().describe('Background color hex (default: #000000)'),
  padding: z.number().optional().describe('Frame padding in px (default: 80, must follow 8px grid)'),
});

export type BuildAdSkeletonInput = z.infer<typeof buildAdSkeletonSchema>;

/**
 * Convert hex color to RGB object
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  // Remove # if present
  const cleanHex = hex.replace(/^#/, '');

  // Parse hex values
  const r = parseInt(cleanHex.substring(0, 2), 16) / 255;
  const g = parseInt(cleanHex.substring(2, 4), 16) / 255;
  const b = parseInt(cleanHex.substring(4, 6), 16) / 255;

  return { r, g, b };
}

export async function buildAdSkeleton(input: BuildAdSkeletonInput, bridge: Bridge): Promise<any> {
  // Resolve dimensions based on format
  let width: number;
  let height: number;

  if (input.format === 'story') {
    width = 1080;
    height = 1920;
  } else if (input.format === 'feed') {
    width = 1080;
    height = 1080;
  } else {
    // custom format
    if (!input.width || !input.height) {
      throw new Error('Custom format requires width and height');
    }
    width = input.width;
    height = input.height;
  }

  const name = input.name || 'Ad Frame';
  const backgroundColor = input.backgroundColor || '#000000';
  const padding = input.padding || 80;

  // Convert hex to RGB
  const bgColor = hexToRgb(backgroundColor);

  // Create frame with auto-layout
  const result = await bridge.sendCommand({
    type: 'figma_call',
    method: 'createFrame',
    args: [
      {
        name,
        width,
        height,
        fills: [{ type: 'SOLID', color: bgColor }],
        layoutMode: 'VERTICAL',
        paddingTop: padding,
        paddingRight: padding,
        paddingBottom: padding,
        paddingLeft: padding,
        itemSpacing: 32, // Default spacing between children
        primaryAxisAlignItems: 'MIN', // Top-aligned
        counterAxisAlignItems: 'CENTER', // Horizontally centered
        primaryAxisSizingMode: 'FIXED',
        counterAxisSizingMode: 'FIXED',
        layoutSizingHorizontal: 'FIXED',
        layoutSizingVertical: 'FIXED',
      },
    ],
  });

  // Unwrap the Figma response — plugin returns { id: "nodeId" }
  const frameId = typeof result === 'object' && result?.id ? result.id : result;

  // Calculate safe zones for story format
  const safeZoneTop = input.format === 'story' ? 250 : 0;
  const safeZoneBottom = input.format === 'story' ? height - 250 : height;

  return {
    frameId,
    dimensions: { width, height },
    padding,
    safeZone: {
      top: safeZoneTop,
      bottom: safeZoneBottom,
      usableHeight: safeZoneBottom - safeZoneTop,
    },
    message: `Created ${input.format} frame (${width}x${height}px) with ${padding}px padding. ${
      input.format === 'story' ? 'Safe zone: 250px top/bottom.' : ''
    }`,
  };
}
