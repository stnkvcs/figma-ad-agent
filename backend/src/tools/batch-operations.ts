/**
 * batch_operations tool
 *
 * Compact DSL for multi-node creation in a single round trip.
 * Parses the DSL string, converts tool-level props to Figma-ready format,
 * reads image files for SET_IMAGE_FILL, then sends everything to the plugin.
 */

import { z } from 'zod';
import { readFileSync } from 'fs';
import type { Bridge } from '../bridge.js';
import { parseDSL } from './dsl-parser.js';
import { convertProperties } from './batch-update.js';
import { hexToRgb, hexToRgba, rotationToGradientTransform } from './utils.js';
import { logBatchOperations } from '../telemetry/tracker.js';

export const batchOperationsSchema = z.object({
  operations: z.string().describe(
    'DSL script. One operation per line. $varName refs nodes from earlier CREATE lines. Max 50 operations.\n\n' +
    'Operations:\n' +
    '  var=CREATE_FRAME($parent, {width: 1080, height: 1920, fillColor: "#0a0a0a", layoutMode: "VERTICAL", ...})\n' +
    '  var=CREATE_TEXT($parent, {text: "Hello", fontSize: 120, fontColor: "#FFF", fontFamily: "Inter", fontWeight: 400})\n' +
    '  var=CREATE_RECT($parent, {width: 100, height: 100, fillColor: "#FF0000", cornerRadius: 16})\n' +
    '  SET_IMAGE_FILL($node, {imagePath: "/abs/path.png", scaleMode: "FILL"})\n' +
    '  TRIM($node)\n' +
    '  UPDATE($node, {x: 100, opacity: 0.5, fillColor: "#000"})\n' +
    '  SET_GRADIENT($node, {gradientType: "LINEAR", gradientStops: [{position: 0, color: "#000"}, {position: 1, color: "#FFF"}], rotation: 180})\n' +
    '  ADD_EFFECT($node, {type: "DROP_SHADOW", color: "#0000001A", offset: {x: 0, y: 4}, radius: 8})\n' +
    '  DELETE($node)\n' +
    '  REPARENT($node, $newParent, index?)\n' +
    '  // Comments start with //'
  ),
});

export type BatchOperationsInput = z.infer<typeof batchOperationsSchema>;

export async function batchOperations(input: BatchOperationsInput, bridge: Bridge): Promise<any> {
  // 1. Parse DSL
  const parsed = parseDSL(input.operations);

  // 2. Validate limits
  if (parsed.length > 50) {
    throw new Error(`Too many operations: ${parsed.length} (max 50)`);
  }
  if (parsed.length === 0) {
    throw new Error('No operations parsed from DSL');
  }

  // 3. Process each operation: convert props, load images
  const processedOps = [];
  for (const op of parsed) {
    const processed = { ...op };

    // Convert tool-level props to Figma-ready format
    if (processed.props && Object.keys(processed.props).length > 0) {
      processed.props = convertToolProps(processed.props);
    }

    // For SET_IMAGE_FILL: read image from disk → base64
    if (processed.op === 'SET_IMAGE_FILL' && processed.props) {
      const imagePath = processed.props.imagePath;
      if (!imagePath) {
        throw new Error('SET_IMAGE_FILL requires imagePath in props');
      }
      try {
        const buffer = readFileSync(imagePath);
        processed.base64 = buffer.toString('base64');
      } catch (err) {
        throw new Error(`Failed to read image at ${imagePath}: ${err instanceof Error ? err.message : String(err)}`);
      }
      processed.scaleMode = processed.props.scaleMode || 'FILL';
      // Remove image-specific props (handled separately in plugin)
      delete processed.props.imagePath;
      delete processed.props.scaleMode;
    }

    // For SET_GRADIENT: convert color strings to RGB and compute transform
    if (processed.op === 'SET_GRADIENT' && processed.props) {
      const stops = processed.props.gradientStops;
      if (stops && Array.isArray(stops)) {
        processed.props.gradientStops = stops.map((s: any) => ({
          position: s.position,
          color: typeof s.color === 'string' ? hexToRgba(s.color) : s.color,
        }));
      }
      if (processed.props.rotation !== undefined) {
        processed.props.gradientTransform = rotationToGradientTransform(processed.props.rotation);
        delete processed.props.rotation;
      }
    }

    // For ADD_EFFECT: convert color string to RGBA
    if (processed.op === 'ADD_EFFECT' && processed.props) {
      if (processed.props.color && typeof processed.props.color === 'string') {
        processed.props.color = hexToRgba(processed.props.color);
      }
    }

    processedOps.push(processed);
  }

  // 4. Log to telemetry
  logBatchOperations({
    timestamp: new Date().toISOString(),
    opCount: processedOps.length,
    opSequence: processedOps.map(o => o.op).join(','),
    operations: processedOps.map(o => ({
      op: o.op,
      propsKeys: o.props ? Object.keys(o.props) : undefined,
    })),
  });

  // 5. Send to plugin as single command
  const result = await bridge.sendCommand({
    type: 'batch_operations',
    operations: processedOps,
  });

  // 6. Format summary
  const summary: string[] = [];
  const bindings: Record<string, string> = {};

  if (result.results) {
    for (const r of result.results) {
      if (r.variable && r.nodeId) {
        bindings[r.variable] = r.nodeId;
        summary.push(`${r.variable} → ${r.nodeId} (${r.op})`);
      } else if (r.op) {
        summary.push(`${r.op} → ${r.success ? 'ok' : r.error}`);
      }
    }
  }

  return {
    message: `Executed ${processedOps.length} operations`,
    results: summary,
    variableBindings: bindings,
    errors: result.errors || [],
  };
}

/**
 * Convert tool-level property names to Figma-ready properties.
 * Handles fillColor→fills, fontColor→fills, etc.
 * Reuses convertProperties from batch-update for shared properties,
 * but also handles properties specific to batch_operations DSL.
 */
function convertToolProps(props: Record<string, any>): Record<string, any> {
  // Use batch-update's convertProperties for the standard set
  const converted = convertProperties(props as any);

  // Pass through any props that convertProperties doesn't handle
  // (e.g., layoutMode, clipsContent, etc. are handled by convertProperties)
  // Also pass through Figma-native props that tools don't abstract
  const passthroughKeys = [
    'fills', 'strokes', 'effects',
    'primaryAxisSizingMode', 'counterAxisSizingMode',
  ];
  for (const key of passthroughKeys) {
    if (props[key] !== undefined && converted[key] === undefined) {
      converted[key] = props[key];
    }
  }

  return converted;
}
