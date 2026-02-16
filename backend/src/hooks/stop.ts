/**
 * Stop hooks
 *
 * Fires when the agent session ends. Used for cleanup and logging.
 */

import type { HookCallbackMatcher, HookInput, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import { getSessionState } from '../session-state.js';
import { runAnalysisAndSaveDrafts } from '../telemetry/tracker.js';

const sessionEndHook: HookCallbackMatcher = {
  hooks: [
    async (_input: HookInput, _toolUseID: string | undefined, _options: { signal: AbortSignal }): Promise<HookJSONOutput> => {
      const session = getSessionState();
      if (session) {
        console.log(`[Hooks] Session ending — Brand: ${session.brand}/${session.product}, Concepts: ${session.conceptSummaries.length}, Cost: $${session.totalCost.toFixed(2)}`);
      } else {
        console.log('[Hooks] Session ending — no active session');
      }

      // Run telemetry pattern analysis and save draft tools
      try {
        runAnalysisAndSaveDrafts();
      } catch (err) {
        console.warn('[Hooks] Telemetry analysis failed:', err);
      }

      return {};
    },
  ],
};

export const stopHooks: HookCallbackMatcher[] = [sessionEndHook];
