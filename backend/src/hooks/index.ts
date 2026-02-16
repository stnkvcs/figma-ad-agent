/**
 * Hooks registry
 *
 * Builds the hooks configuration for the Agent SDK.
 * Maps hook event types to their callback matchers.
 */

import type { HookEvent, HookCallbackMatcher } from '@anthropic-ai/claude-agent-sdk';
import { preToolUseHooks } from './pre-tool-use.js';
import { postToolUseHooks } from './post-tool-use.js';
import { stopHooks } from './stop.js';

export function buildHooks(): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {};

  if (preToolUseHooks.length > 0) {
    hooks.PreToolUse = preToolUseHooks;
  }
  if (postToolUseHooks.length > 0) {
    hooks.PostToolUse = postToolUseHooks;
  }
  if (stopHooks.length > 0) {
    hooks.Stop = stopHooks;
  }

  return hooks;
}
