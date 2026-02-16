/**
 * Post-tool-use hooks
 *
 * Runs after asset generation tools complete.
 * Injects running session cost into agent context and reminds
 * the agent to place the generated image on the canvas.
 *
 * Phase 4 upgrade: add async asset queue check + notification injection
 * for fire-and-continue parallel generation.
 */

import type { HookCallbackMatcher, HookInput, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import { getSessionState } from '../session-state.js';
import { markCostEstimated } from './pre-tool-use.js';

function makeAssetHook(toolLabel: string): HookCallbackMatcher {
  return {
    matcher: `mcp__figma-design__${toolLabel}`,
    hooks: [
      async (_input: HookInput, _toolUseID: string | undefined, _options: { signal: AbortSignal }): Promise<HookJSONOutput> => {
        const session = getSessionState();
        const runningCost = session?.totalCost ?? 0;

        return {
          hookSpecificOutput: {
            hookEventName: 'PostToolUse' as const,
            additionalContext: `Asset generated. Session cost so far: $${runningCost.toFixed(2)}. Use place_product or set_background to put this image on the canvas.`,
          },
        };
      },
    ],
  };
}

const estimateCostMarker: HookCallbackMatcher = {
  matcher: 'mcp__figma-design__estimate_cost',
  hooks: [
    async (_input: HookInput, _toolUseID: string | undefined, _options: { signal: AbortSignal }): Promise<HookJSONOutput> => {
      markCostEstimated();
      return {};
    },
  ],
};

export const postToolUseHooks: HookCallbackMatcher[] = [
  makeAssetHook('generate_product_photo'),
  makeAssetHook('generate_asset'),
  makeAssetHook('remove_background'),
  estimateCostMarker,
];
