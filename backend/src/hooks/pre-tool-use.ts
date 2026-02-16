/**
 * Pre-tool-use hooks
 *
 * Inject context or gate tool calls before they execute.
 * The export quality gate ensures Tier 1 checks happen before any ad export.
 * The budget warning reminds the agent to estimate costs before generating.
 */

import type { HookCallbackMatcher, HookInput, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk';

// ─── Cost estimation state ───

let costEstimated = false;

export function resetCostEstimated(): void {
  costEstimated = false;
}

export function markCostEstimated(): void {
  costEstimated = true;
}

// ─── Hooks ───

const exportQualityGate: HookCallbackMatcher = {
  matcher: 'mcp__figma-design__export_ad',
  hooks: [
    async (_input: HookInput, _toolUseID: string | undefined, _options: { signal: AbortSignal }): Promise<HookJSONOutput> => {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse' as const,
          additionalContext: `QUALITY GATE — Before exporting, verify ALL Tier 1 items:
□ Headline prominent and impossible to miss
□ All customer-facing text 40px+, secondary 32px+
□ Elements breathing — headline-to-subhead 24-40px gap, text-to-image 40-60px
□ Critical elements within safe zones (not in top/bottom 250px for story format)
□ Product naturally integrated — no sharp-edge floating, no cut-off hands
□ Would someone stop scrolling for this?
□ Does every element serve ONE concept?
If ANY item fails, fix it BEFORE exporting. No exceptions.`,
        },
      };
    },
  ],
};

function makeBudgetWarningHook(toolName: string): HookCallbackMatcher {
  return {
    matcher: `mcp__figma-design__${toolName}`,
    hooks: [
      async (_input: HookInput, _toolUseID: string | undefined, _options: { signal: AbortSignal }): Promise<HookJSONOutput> => {
        if (!costEstimated) {
          return {
            hookSpecificOutput: {
              hookEventName: 'PreToolUse' as const,
              additionalContext: 'WARNING: You are generating an asset without calling estimate_cost first. Consider running estimate_cost to present the cost to the user before proceeding.',
            },
          };
        }
        return {};
      },
    ],
  };
}

export const preToolUseHooks: HookCallbackMatcher[] = [
  exportQualityGate,
  makeBudgetWarningHook('generate_product_photo'),
  makeBudgetWarningHook('generate_asset'),
];
