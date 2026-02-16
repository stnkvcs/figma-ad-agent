/**
 * apply_typography tool
 *
 * Creates a multi-element text composition inside a frame.
 * Handles role-based sizing, split-and-stack headlines, and proper
 * auto-resize modes so the agent doesn't have to manage text layout manually.
 *
 * Encapsulates patterns from patterns.md:
 * - "Text inside cards — use FILL width + HEIGHT auto-resize"
 * - "Tight headline line-height — split-and-stack workaround"
 * - "Font weight — use numeric values"
 * - "Text auto-resize modes" (WIDTH_AND_HEIGHT vs HEIGHT)
 */

import { z } from 'zod';
import type { Bridge } from '../bridge.js';
import { hexToRgb, weightToStyle } from './utils.js';

const elementSchema = z.object({
  role: z.enum(['headline', 'subhead', 'body', 'label', 'fine_print']),
  text: z.string(),
  fontSize: z.number().optional().describe('Override default font size for this role'),
  fontFamily: z.string().optional().describe('Font family (default: Inter)'),
  fontWeight: z.number().optional().describe('Font weight: 200=Ultralight, 300=Light, 400=Regular, 500=Medium, 600=SemiBold'),
  fontStyle: z.string().optional().describe('Exact font style name override (e.g., "Ultralight", "Italic"). Bypasses fontWeight mapping.'),
  fontColor: z.string().optional().describe('Text color hex (default: #FFFFFF)'),
  textAlign: z.enum(['LEFT', 'CENTER', 'RIGHT']).optional().describe('Horizontal text alignment'),
});

export const applyTypographySchema = z.object({
  frameId: z.string().describe('Parent frame ID'),
  elements: z.array(elementSchema).describe('Text elements to create, in order'),
  spacing: z.number().optional().describe('Spacing between elements. Default: 32'),
  clearExisting: z.boolean().optional().describe('Delete all existing children before adding new text. Use when rebuilding typography from scratch.'),
});

export type ApplyTypographyInput = z.infer<typeof applyTypographySchema>;

/** Role-based defaults for text sizing and layout */
interface RoleDefaults {
  fontSize: number;
  fontWeight: number;
  textAutoResize: string;
  layoutSizingHorizontal?: string;
}

const ROLE_DEFAULTS: Record<string, RoleDefaults> = {
  headline: {
    fontSize: 120,
    fontWeight: 400,
    textAutoResize: 'WIDTH_AND_HEIGHT',
    // No layoutSizingHorizontal — single-line headlines auto-size to content
  },
  subhead: {
    fontSize: 48,
    fontWeight: 400,
    textAutoResize: 'HEIGHT',
    layoutSizingHorizontal: 'FILL',
  },
  body: {
    fontSize: 40,
    fontWeight: 400,
    textAutoResize: 'HEIGHT',
    layoutSizingHorizontal: 'FILL',
  },
  label: {
    fontSize: 32,
    fontWeight: 500,
    textAutoResize: 'WIDTH_AND_HEIGHT',
  },
  fine_print: {
    fontSize: 24,
    fontWeight: 400,
    textAutoResize: 'HEIGHT',
    layoutSizingHorizontal: 'FILL',
  },
};

/**
 * Create a single text node via bridge
 */
interface TextNodeResult {
  id: string;
  fontApplied?: { family: string; style: string };
}

async function createTextNode(
  bridge: Bridge,
  parentId: string,
  characters: string,
  opts: {
    fontSize: number;
    fontColor: { r: number; g: number; b: number };
    fontFamily: string;
    fontStyle: string;
    textAutoResize: string;
    textAlignHorizontal?: string;
    layoutSizingHorizontal?: string;
  },
): Promise<TextNodeResult> {
  const result = await bridge.sendCommand({
    type: 'figma_call',
    method: 'createText',
    args: [{
      parentId,
      characters,
      fontSize: opts.fontSize,
      fontColor: opts.fontColor,
      fontFamily: opts.fontFamily,
      fontStyle: opts.fontStyle,
      textAutoResize: opts.textAutoResize,
      textAlignHorizontal: opts.textAlignHorizontal,
      layoutSizingHorizontal: opts.layoutSizingHorizontal,
    }],
  });

  return { id: result.id, fontApplied: result.fontApplied };
}

/**
 * Split-and-stack: create a wrapper frame with one text node per line.
 * Workaround for Figma's unreliable lineHeight on headlines.
 * Tight spacing = fontSize * 0.1 (e.g., 120px font → 12px gap).
 */
async function createSplitStack(
  bridge: Bridge,
  parentId: string,
  lines: string[],
  opts: {
    fontSize: number;
    fontColor: { r: number; g: number; b: number };
    fontFamily: string;
    fontStyle: string;
    textAlignHorizontal?: string;
  },
): Promise<{ wrapperId: string; textNodeIds: string[] }> {
  const lineGap = Math.round(opts.fontSize * 0.1);

  // Create vertical wrapper frame
  const wrapperResult = await bridge.sendCommand({
    type: 'figma_call',
    method: 'createFrame',
    args: [{
      parentId,
      name: 'Headline Stack',
      layoutMode: 'VERTICAL',
      itemSpacing: lineGap,
      layoutSizingHorizontal: 'HUG',
      layoutSizingVertical: 'HUG',
      fills: [], // transparent wrapper
    }],
  });

  const wrapperId = wrapperResult.id;
  const textNodeIds: string[] = [];

  // Create one text node per line
  for (const line of lines) {
    const result = await createTextNode(bridge, wrapperId, line, {
      fontSize: opts.fontSize,
      fontColor: opts.fontColor,
      fontFamily: opts.fontFamily,
      fontStyle: opts.fontStyle,
      textAutoResize: 'WIDTH_AND_HEIGHT',
      textAlignHorizontal: opts.textAlignHorizontal,
    });
    textNodeIds.push(result.id);
  }

  return { wrapperId, textNodeIds };
}

export async function applyTypography(input: ApplyTypographyInput, bridge: Bridge): Promise<any> {
  const spacing = input.spacing || 32;
  const createdIds: string[] = [];
  const summaries: string[] = [];
  const fontWarnings: string[] = [];

  // Clear existing children if requested (rebuild from scratch)
  if (input.clearExisting) {
    const frameState = await bridge.sendCommand({
      type: 'figma_call',
      method: 'getNodeById',
      args: [input.frameId],
    });
    if (frameState.children && Array.isArray(frameState.children)) {
      for (const child of frameState.children) {
        await bridge.sendCommand({
          type: 'figma_call',
          method: 'deleteNode',
          args: [child.id],
        });
      }
    }
  }

  // Set spacing on the parent frame (assumes it has auto-layout)
  await bridge.sendCommand({
    type: 'figma_call',
    method: 'updateNode',
    args: [input.frameId, { itemSpacing: spacing }],
  });

  for (const element of input.elements) {
    const defaults = ROLE_DEFAULTS[element.role];
    const fontSize = element.fontSize || defaults.fontSize;
    const fontWeight = element.fontWeight || defaults.fontWeight;
    const fontFamily = element.fontFamily || 'Inter';
    const fontColor = hexToRgb(element.fontColor || '#FFFFFF');
    const fontStyle = element.fontStyle || weightToStyle(fontWeight);
    const textAlign = element.textAlign;

    // Headlines with newlines use split-and-stack
    const isHeadline = element.role === 'headline';
    const hasNewlines = element.text.includes('\n');

    if (isHeadline && hasNewlines) {
      const lines = element.text.split('\n').filter(line => line.length > 0);
      const { wrapperId, textNodeIds } = await createSplitStack(
        bridge,
        input.frameId,
        lines,
        { fontSize, fontColor, fontFamily, fontStyle, textAlignHorizontal: textAlign },
      );
      createdIds.push(wrapperId);
      summaries.push(`headline (split-stack, ${lines.length} lines, ${fontSize}px, ${fontFamily} ${fontStyle})`);
    } else {
      // Simple text node
      const result = await createTextNode(bridge, input.frameId, element.text, {
        fontSize,
        fontColor,
        fontFamily,
        fontStyle,
        textAutoResize: defaults.textAutoResize,
        textAlignHorizontal: textAlign,
        layoutSizingHorizontal: defaults.layoutSizingHorizontal,
      });
      createdIds.push(result.id);

      // Check for font fallback
      const applied = result.fontApplied;
      if (applied && (applied.family !== fontFamily || applied.style !== fontStyle)) {
        fontWarnings.push(`${element.role}: requested ${fontFamily}/${fontStyle}, got ${applied.family}/${applied.style}`);
        summaries.push(`${element.role} (${fontSize}px, ${applied.family} ${applied.style} ⚠ FALLBACK)`);
      } else {
        summaries.push(`${element.role} (${fontSize}px, ${fontFamily} ${fontStyle})`);
      }
    }
  }

  const message = `Created ${createdIds.length} text elements: ${summaries.join(', ')}`;
  const warning = fontWarnings.length > 0
    ? `\nFONT WARNINGS: ${fontWarnings.join('; ')}. Check that the font is installed in your Figma workspace.`
    : '';

  return {
    textNodeIds: createdIds,
    message: message + warning,
  };
}
