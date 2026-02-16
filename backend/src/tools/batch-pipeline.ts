/**
 * batch_pipeline tool
 *
 * Chain existing high-level tools with $ref variable binding.
 * One round trip (model call) instead of 6-10 sequential tool calls.
 * Auto-checkpoints after step 1 and rolls back on failure.
 *
 * NOT allowed in pipeline (async/non-deterministic/meta):
 * generate_product_photo, generate_asset, remove_background, estimate_cost,
 * raw_figma_operation, read_brand_data, browse_ad_library, complete_concept,
 * log_learning, checkpoint tools.
 */

import { z } from 'zod';
import type { Bridge } from '../bridge.js';
import { saveCheckpoint, restoreCheckpoint } from './checkpoint.js';

// Lazy tool handler imports — resolved on first use
let _toolHandlers: Record<string, (input: any, bridge: Bridge) => Promise<any>> | null = null;

const ALLOWED_TOOLS = [
  'build_ad_skeleton', 'apply_typography', 'set_background',
  'place_product', 'add_effect', 'get_canvas_screenshot',
  'update_node', 'batch_update', 'delete_node',
  'create_shape', 'duplicate_frame', 'reorder_children',
] as const;

type AllowedTool = typeof ALLOWED_TOOLS[number];

const pipelineStepSchema = z.object({
  id: z.string().describe('Step ID for variable binding'),
  tool: z.enum(ALLOWED_TOOLS).describe('Tool to invoke'),
  args: z.record(z.string(), z.any()).describe('Tool args. Use $stepId.field to reference earlier results.'),
});

export const batchPipelineSchema = z.object({
  pipeline: z.array(pipelineStepSchema)
    .min(1).max(20)
    .describe('Array of pipeline steps. Each step can reference results from earlier steps via $stepId.field.path syntax.'),
});

export type BatchPipelineInput = z.infer<typeof batchPipelineSchema>;

/**
 * Lazily build the tool handler registry.
 * Maps tool names to their imported handler functions.
 */
async function getToolHandlers(): Promise<Record<string, (input: any, bridge: Bridge) => Promise<any>>> {
  if (_toolHandlers) return _toolHandlers;

  // Dynamic imports to avoid circular dependencies
  const [
    { buildAdSkeleton },
    { applyTypography },
    { setBackground },
    { placeProduct },
    { addEffect },
    { getCanvasScreenshot },
    { updateNode },
    { batchUpdate },
    { deleteNode },
    { createShape },
    { duplicateFrame },
    { reorderChildren },
  ] = await Promise.all([
    import('./build-ad-skeleton.js'),
    import('./apply-typography.js'),
    import('./set-background.js'),
    import('./place-product.js'),
    import('./add-effect.js'),
    import('./get-canvas-screenshot.js'),
    import('./update-node.js'),
    import('./batch-update.js'),
    import('./delete-node.js'),
    import('./create-shape.js'),
    import('./duplicate-frame.js'),
    import('./reorder-children.js'),
  ]);

  _toolHandlers = {
    build_ad_skeleton: buildAdSkeleton,
    apply_typography: applyTypography,
    set_background: setBackground,
    place_product: placeProduct,
    add_effect: addEffect,
    get_canvas_screenshot: getCanvasScreenshot,
    update_node: updateNode,
    batch_update: batchUpdate,
    delete_node: deleteNode,
    create_shape: createShape,
    duplicate_frame: duplicateFrame,
    reorder_children: reorderChildren,
  };

  return _toolHandlers;
}

/**
 * Deep-walk an object and resolve $stepId.field.path references.
 */
function resolveVariables(obj: any, bindings: Map<string, any>): any {
  if (typeof obj === 'string' && obj.startsWith('$')) {
    // Parse $stepId.field.path
    const path = obj.substring(1).split('.');
    const stepId = path[0];
    const result = bindings.get(stepId);
    if (result === undefined) {
      throw new Error(`Unresolved reference: ${obj} (step "${stepId}" not found in completed steps)`);
    }

    // Traverse the path
    let value = result;
    for (let i = 1; i < path.length; i++) {
      if (value === null || value === undefined) {
        throw new Error(`Cannot resolve ${obj}: null at "${path.slice(0, i + 1).join('.')}"`);
      }
      value = value[path[i]];
    }
    return value;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => resolveVariables(item, bindings));
  }

  if (obj !== null && typeof obj === 'object') {
    const resolved: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      resolved[key] = resolveVariables(value, bindings);
    }
    return resolved;
  }

  return obj;
}

export async function batchPipeline(input: BatchPipelineInput, bridge: Bridge): Promise<any> {
  const handlers = await getToolHandlers();
  const bindings = new Map<string, any>();
  const completed: Array<{ id: string; tool: string; summary: string }> = [];
  let autoCheckpointLabel: string | null = null;

  for (let i = 0; i < input.pipeline.length; i++) {
    const step = input.pipeline[i];

    // Validate tool name
    if (!handlers[step.tool]) {
      return {
        completed,
        failed: { step: step.id, tool: step.tool, error: `Unknown tool: ${step.tool}` },
        rolledBack: false,
      };
    }

    try {
      // Resolve variable references in args
      const resolvedArgs = resolveVariables(step.args, bindings);
      console.log(`[Pipeline] Step ${i + 1}/${input.pipeline.length}: ${step.tool} (id: ${step.id})`);
      console.log(`[Pipeline]   Resolved args:`, JSON.stringify(resolvedArgs).substring(0, 300));

      // Execute the tool handler
      const result = await handlers[step.tool](resolvedArgs, bridge);

      // Store result in bindings
      bindings.set(step.id, result);

      // Build summary
      const summaryText = typeof result?.message === 'string'
        ? result.message
        : `${step.tool} completed`;
      completed.push({ id: step.id, tool: step.tool, summary: summaryText });

      // Auto-checkpoint after step 1 if it returned a frameId
      if (i === 0 && result?.frameId) {
        try {
          autoCheckpointLabel = '_pipeline_auto';
          await saveCheckpoint({ frameId: result.frameId, label: autoCheckpointLabel }, bridge);
        } catch {
          // Non-blocking: checkpoint failure shouldn't stop pipeline
          autoCheckpointLabel = null;
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Attempt rollback if we have an auto-checkpoint
      let rolledBack = false;
      if (autoCheckpointLabel) {
        try {
          await restoreCheckpoint({ label: autoCheckpointLabel }, bridge);
          rolledBack = true;
        } catch {
          // Rollback failed — return without rollback
        }
      }

      return {
        completed,
        failed: { step: step.id, tool: step.tool, error: errorMsg },
        rolledBack,
      };
    }
  }

  // Build the final bindings summary (only serializable values)
  const bindingsSummary: Record<string, any> = {};
  for (const [key, value] of bindings.entries()) {
    // Only include simple result objects, not huge image data
    if (typeof value === 'object' && value !== null) {
      const { content, ...rest } = value; // Strip image content blocks
      bindingsSummary[key] = rest;
    } else {
      bindingsSummary[key] = value;
    }
  }

  return {
    completed,
    bindings: bindingsSummary,
    message: `Pipeline completed: ${completed.length} steps executed`,
  };
}
