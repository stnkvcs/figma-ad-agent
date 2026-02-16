/**
 * set_background tool
 *
 * Sets the background of a frame: solid color, gradient, or image.
 */

import { z } from 'zod';
import type { Bridge } from '../bridge.js';
import { hexToRgb, hexToRgba, readFileAsBase64, rotationToGradientTransform } from './utils.js';

export const setBackgroundSchema = z.object({
  frameId: z.string().describe('Frame ID to set background on'),
  type: z.enum(['solid', 'gradient', 'image']).describe('Background type'),
  color: z.string().optional().describe('Hex color for solid background (e.g., #FF0000)'),
  gradient: z
    .object({
      stops: z.array(
        z.object({
          position: z.number().min(0).max(1).describe('Position 0-1'),
          color: z.string().describe('Hex color for this stop'),
        }),
      ),
      rotation: z.number().optional().describe('Gradient rotation in degrees (default: 180 = top to bottom)'),
    })
    .optional()
    .describe('Gradient configuration'),
  imagePath: z.string().optional().describe('Absolute path to image file'),
  scaleMode: z.enum(['FILL', 'FIT']).optional().describe('Image scale mode (default: FILL)'),
});

export type SetBackgroundInput = z.infer<typeof setBackgroundSchema>;

export async function setBackground(input: SetBackgroundInput, bridge: Bridge): Promise<any> {
  if (input.type === 'solid') {
    if (!input.color) {
      throw new Error('solid background requires color parameter');
    }

    const color = hexToRgb(input.color);

    await bridge.sendCommand({
      type: 'figma_call',
      method: 'updateNode',
      args: [
        input.frameId,
        {
          fills: [{ type: 'SOLID', color }],
        },
      ],
    });

    return {
      message: `Set solid background: ${input.color}`,
    };
  } else if (input.type === 'gradient') {
    if (!input.gradient || !input.gradient.stops || input.gradient.stops.length < 2) {
      throw new Error('gradient background requires at least 2 gradient stops');
    }

    const gradientStops = input.gradient.stops.map((stop) => ({
      position: stop.position,
      color: hexToRgba(stop.color),
    }));

    const rotation = input.gradient.rotation ?? 180;
    const gradientTransform = rotationToGradientTransform(rotation);

    await bridge.sendCommand({
      type: 'figma_call',
      method: 'updateNode',
      args: [
        input.frameId,
        {
          fills: [
            {
              type: 'GRADIENT_LINEAR',
              gradientStops,
              gradientTransform,
            },
          ],
        },
      ],
    });

    return {
      message: `Set gradient background: ${input.gradient.stops.length} stops, ${rotation}° rotation`,
    };
  } else if (input.type === 'image') {
    if (!input.imagePath) {
      throw new Error('image background requires imagePath parameter');
    }

    const base64 = readFileAsBase64(input.imagePath);
    const scaleMode = input.scaleMode || 'FILL';

    await bridge.sendCommand({
      type: 'image_data',
      base64,
      targetNodeId: input.frameId,
      scaleMode,
    });

    return {
      message: `Set image background: ${input.imagePath} (${scaleMode})`,
    };
  }

  throw new Error(`Unknown background type: ${input.type}`);
}
