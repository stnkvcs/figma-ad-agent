/**
 * place_product tool
 *
 * Multi-step orchestration for placing a product image into a frame.
 * Handles: read image → trim transparency → calculate dimensions →
 * create frame → apply image fill → position with preset.
 *
 * Encapsulates patterns that previously required 4-5 manual MCP calls:
 * - Always trims transparent pixels (patterns.md: "always trim after placing transparent image")
 * - Creates frame with ABSOLUTE positioning (patterns.md: "absolute positioning inside auto-layout")
 * - Sets empty fills for transparent frame before image fill
 * - Scales relative to parent frame width
 */

import { z } from 'zod';
import { readFileSync } from 'fs';
import type { Bridge } from '../bridge.js';
import { trimTransparentPixels, getImageDimensions } from './image-analysis.js';

export const placeProductSchema = z.object({
  frameId: z.string().describe('Parent frame ID'),
  imagePath: z.string().describe('Absolute path to product image file'),
  position: z.enum([
    'center', 'center-bottom', 'left', 'right', 'top', 'bottom',
    'off-frame-right', 'off-frame-left', 'custom',
  ]).optional().describe('Preset position (default: center-bottom)'),
  customX: z.number().optional().describe('Custom X position (only when position is "custom")'),
  customY: z.number().optional().describe('Custom Y position (only when position is "custom")'),
  scale: z.number().optional().describe('Scale relative to frame width, 0.6 = 60%. Default: 0.7'),
  trimTransparency: z.boolean().optional().describe('Trim transparent pixels before placement. Default: true'),
});

export type PlaceProductInput = z.infer<typeof placeProductSchema>;

/** Position preset to x/y calculator */
type PositionCalculator = (parentW: number, parentH: number, prodW: number, prodH: number, padding: number) => { x: number; y: number };

const POSITION_PRESETS: Record<string, PositionCalculator> = {
  'center': (pw, ph, w, h) => ({
    x: (pw - w) / 2,
    y: (ph - h) / 2,
  }),
  'center-bottom': (pw, ph, w, h, pad) => ({
    x: (pw - w) / 2,
    y: ph - h - pad,
  }),
  'top': (pw, _ph, w, _h, pad) => ({
    x: (pw - w) / 2,
    y: pad,
  }),
  'bottom': (pw, ph, w, h) => ({
    x: (pw - w) / 2,
    y: ph - h,
  }),
  'left': (_pw, ph, _w, h) => ({
    x: 0,
    y: (ph - h) / 2,
  }),
  'right': (pw, ph, w, h) => ({
    x: pw - w,
    y: (ph - h) / 2,
  }),
  'off-frame-right': (pw, ph, w, h) => ({
    x: pw - w * 0.3,  // 30% visible from right edge
    y: (ph - h) / 2,
  }),
  'off-frame-left': (_pw, ph, w, h) => ({
    x: -w * 0.7,  // 30% visible from left edge
    y: (ph - h) / 2,
  }),
};

export async function placeProduct(input: PlaceProductInput, bridge: Bridge): Promise<any> {
  const position = input.position || 'center-bottom';
  const scale = input.scale || 0.7;
  const shouldTrim = input.trimTransparency !== false; // default true

  // 1. Read image from disk
  const rawBuffer = readFileSync(input.imagePath);

  // 2. Optionally trim transparent pixels
  let imageBuffer: Buffer;
  let imgWidth: number;
  let imgHeight: number;

  if (shouldTrim) {
    const trimResult = await trimTransparentPixels(rawBuffer);
    imageBuffer = trimResult.trimmedBuffer;
    imgWidth = trimResult.trimmedWidth;
    imgHeight = trimResult.trimmedHeight;
  } else {
    const dims = await getImageDimensions(rawBuffer);
    imageBuffer = rawBuffer;
    imgWidth = dims.width;
    imgHeight = dims.height;
  }

  if (imgWidth === 0 || imgHeight === 0) {
    throw new Error('Image has zero dimensions — file may be corrupt or empty');
  }

  // 3. Get parent frame dimensions
  const parentInfo = await bridge.sendCommand({
    type: 'figma_call',
    method: 'getNodeById',
    args: [input.frameId],
  });

  const parentWidth = parentInfo.width;
  const parentHeight = parentInfo.height;
  const parentPadding = parentInfo.paddingBottom || parentInfo.paddingTop || 80;

  // 4. Calculate product dimensions (scale relative to parent width)
  const productWidth = Math.round(parentWidth * scale);
  const productHeight = Math.round(productWidth * (imgHeight / imgWidth));

  // 5. Create product frame with ABSOLUTE positioning and empty fills
  const frameResult = await bridge.sendCommand({
    type: 'figma_call',
    method: 'createFrame',
    args: [{
      parentId: input.frameId,
      width: productWidth,
      height: productHeight,
      name: 'Product',
      layoutPositioning: 'ABSOLUTE',
      fills: [], // transparent — image fill comes next
    }],
  });

  const productNodeId = frameResult.id;

  // 6. Apply image fill
  const base64 = imageBuffer.toString('base64');
  await bridge.sendCommand({
    type: 'image_data',
    base64,
    targetNodeId: productNodeId,
    scaleMode: 'FILL',
  });

  // 7. Calculate position from preset
  let x: number;
  let y: number;

  if (position === 'custom') {
    x = input.customX ?? 0;
    y = input.customY ?? 0;
  } else {
    const calc = POSITION_PRESETS[position];
    if (!calc) {
      throw new Error(`Unknown position preset: ${position}`);
    }
    const pos = calc(parentWidth, parentHeight, productWidth, productHeight, parentPadding);
    x = Math.round(pos.x);
    y = Math.round(pos.y);
  }

  // 8. Apply position
  await bridge.sendCommand({
    type: 'figma_call',
    method: 'updateNode',
    args: [productNodeId, { x, y }],
  });

  return {
    productNodeId,
    bounds: { x, y, width: productWidth, height: productHeight },
    message: `Placed product at ${position} (${productWidth}x${productHeight}px, ${Math.round(scale * 100)}% of frame width)${shouldTrim ? ' — transparency trimmed' : ''}`,
  };
}
