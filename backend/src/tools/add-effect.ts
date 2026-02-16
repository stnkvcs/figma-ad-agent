/**
 * add_effect tool
 *
 * Adds visual effects to nodes (drop shadow, inner shadow, blur).
 */

import { z } from 'zod';
import type { Bridge } from '../bridge.js';
import { hexToRgba } from './utils.js';

export const addEffectSchema = z.object({
  nodeId: z.string().describe('Node ID to add effect to'),
  type: z
    .enum(['drop_shadow', 'inner_shadow', 'layer_blur', 'background_blur'])
    .describe('Effect type'),
  color: z.string().optional().describe('Shadow color hex (default: #0000001A = 10% black)'),
  offset: z
    .object({
      x: z.number().describe('Shadow X offset in px'),
      y: z.number().describe('Shadow Y offset in px'),
    })
    .optional()
    .describe('Shadow offset (default: {x:0, y:4})'),
  radius: z.number().optional().describe('Blur radius in px (default: 8)'),
  spread: z.number().optional().describe('Shadow spread in px (default: 0, shadows only)'),
});

export type AddEffectInput = z.infer<typeof addEffectSchema>;

export async function addEffect(input: AddEffectInput, bridge: Bridge): Promise<any> {
  // Map input type to Figma effect type
  const typeMap: Record<string, string> = {
    drop_shadow: 'DROP_SHADOW',
    inner_shadow: 'INNER_SHADOW',
    layer_blur: 'LAYER_BLUR',
    background_blur: 'BACKGROUND_BLUR',
  };

  const figmaType = typeMap[input.type];

  // Defaults
  const color = input.color || '#0000001A';
  const offset = input.offset || { x: 0, y: 4 };
  const radius = input.radius ?? 8;
  const spread = input.spread ?? 0;

  // Build new effect
  let newEffect: any;

  if (figmaType === 'DROP_SHADOW' || figmaType === 'INNER_SHADOW') {
    newEffect = {
      type: figmaType,
      visible: true,
      radius,
      color: hexToRgba(color),
      offset,
      spread,
    };
  } else {
    // Blur effects
    newEffect = {
      type: figmaType,
      visible: true,
      radius,
    };
  }

  // Use addEffects (plugin appends in-process — no serialization round-trip)
  await bridge.sendCommand({
    type: 'figma_call',
    method: 'updateNode',
    args: [
      input.nodeId,
      {
        addEffects: [newEffect],
      },
    ],
  });

  return {
    message: `Added ${input.type} effect (radius: ${radius}px)`,
  };
}
