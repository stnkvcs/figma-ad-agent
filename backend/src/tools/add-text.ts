/**
 * add_text tool
 *
 * Creates a text node inside a parent frame.
 */

import { z } from 'zod';
import type { Bridge } from '../bridge.js';

export const addTextSchema = z.object({
  parentId: z.string().describe('Parent frame ID to add text to'),
  text: z.string().describe('Text content'),
  fontSize: z.number().optional().describe('Font size in px (default: 64, must follow 8px grid: 24, 32, 40, 48, 64, 80, 96, 120, 160, 200...)'),
  fontColor: z.string().optional().describe('Text color hex (default: #FFFFFF)'),
  fontFamily: z.string().optional().describe('Font family (default: Inter)'),
  fontWeight: z.number().optional().describe('Font weight: 200=Ultralight, 300=Light, 400=Regular, 500=Medium, 600=SemiBold (default: 400)'),
  fontStyle: z.string().optional().describe('Exact font style name override (e.g., "Ultralight", "Italic", "SemiBold Italic"). When provided, bypasses fontWeight mapping. Use for non-standard style names.'),
  insertIndex: z.number().optional().describe('Z-order index. 0 = behind all siblings (bottom layer), higher = in front. Omit to add on top of all siblings (default).'),
});

export type AddTextInput = z.infer<typeof addTextSchema>;

/**
 * Convert hex color to RGB object
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const cleanHex = hex.replace(/^#/, '');
  const r = parseInt(cleanHex.substring(0, 2), 16) / 255;
  const g = parseInt(cleanHex.substring(2, 4), 16) / 255;
  const b = parseInt(cleanHex.substring(4, 6), 16) / 255;
  return { r, g, b };
}

/**
 * Convert font weight to style string
 * Figma uses style names like "Regular", "Medium", "SemiBold"
 */
function weightToStyle(weight: number): string {
  if (weight <= 300) return 'Light';
  if (weight <= 400) return 'Regular';
  if (weight <= 500) return 'Medium';
  if (weight <= 600) return 'SemiBold';
  return 'Bold';
}

export async function addText(input: AddTextInput, bridge: Bridge): Promise<any> {
  const fontSize = input.fontSize || 64;
  const fontColor = input.fontColor || '#FFFFFF';
  const fontFamily = input.fontFamily || 'Inter';
  const fontWeight = input.fontWeight || 400;

  const color = hexToRgb(fontColor);
  const fontStyle = input.fontStyle || weightToStyle(fontWeight);

  const opts: any = {
    parentId: input.parentId,
    characters: input.text,
    fontSize,
    fontColor: color,
    fontFamily,
    fontStyle,
  };

  if (input.insertIndex !== undefined) {
    opts.insertIndex = input.insertIndex;
  }

  const result = await bridge.sendCommand({
    type: 'figma_call',
    method: 'createText',
    args: [opts],
  });

  // Check if font was silently swapped
  const fontApplied = result.fontApplied;
  const fontWarning = fontApplied && (fontApplied.family !== fontFamily || fontApplied.style !== fontStyle)
    ? ` WARNING: Requested font ${fontFamily}/${fontStyle} not available — fell back to ${fontApplied.family}/${fontApplied.style}`
    : '';

  return {
    textNodeId: result.id,
    message: `Created text node: "${input.text}" (${fontSize}px, ${fontApplied ? `${fontApplied.family} ${fontApplied.style}` : `${fontFamily} ${fontStyle}`})${fontWarning}`,
  };
}
