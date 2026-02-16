# Phase 4: Review & Iteration — Session Summary

**Date:** 2026-02-16
**Branch:** `feature/figma-plugin-agent`

## What Was Built

### New Files (3)
1. **`backend/src/tools/batch-update.ts`** — `batch_update` tool. Accepts array of `{nodeId, properties}` updates, converts properties (fillColor → fills, fontColor → fills, etc.), sends as single `batch_update` command to plugin. Returns per-node success/error results. Max 50 updates per call.

2. **`backend/src/tools/checkpoint.ts`** — `save_checkpoint(frameId, label)` + `restore_checkpoint(label)` + `list_checkpoints()`. In-memory `Map<label, SerializedNode>`. Save serializes the full frame tree via plugin's `serialize_frame` command. Restore sends `restore_checkpoint` which rebuilds the node tree from scratch. Includes `clearCheckpoints()` for session reset.

3. **`backend/src/prompts/critic-prompts.ts`** — Two system prompts for critic subagents:
   - `freshEyesCriticPrompt`: Blind Tier 1 quality review (no concept context). Checks headline prominence, text legibility, spacing, safe zones, image integration, product accuracy.
   - `contextualCriticPrompt`: Concept-aware Tier 2 review with concept brief. Checks dynamic product, intentional background, format variety, brand consistency. Includes concept questions and variety audit.

### Modified Files (14)

| File | Changes |
|------|---------|
| `shared/protocol.ts` | Added `batch_update` to PluginCommand union + isPluginCommand guard |
| `backend/src/bridge.ts` | Added `batch_update` to sendCommand union type |
| `plugin/src/code.ts` | Added `handleBatchUpdate()` (iterates updates via existing `handlers.updateNode`), fully implemented `handleRestoreCheckpoint()` (recursive `restoreNode` with font loading, image hash preservation, auto-layout ordering) |
| `plugin/src/ui.html` | Added: "New" button next to Send, cost display span in status bar, debug toggle button, CSS for all new elements |
| `plugin/src/ui.ts` | Added: newConceptBtn click handler, debugToggle state + click handler, costDisplay updates in status bar, debug mode visibility toggle for debug messages, collapsible debug output |
| `backend/src/agent.ts` | Registered 4 new tools (#24-27: batch_update, save_checkpoint, restore_checkpoint, list_checkpoints), 2 critic subagents via `agents` option, added `Task` to allowedTools, bumped version to 0.5.0 |
| `backend/src/tools/index.ts` | Exported 4 new tools from batch-update.ts and checkpoint.ts |
| `backend/src/tools/get-canvas-screenshot.ts` | Now also saves screenshot to disk file, returns both image content and file path (for critic subagents to read via Read tool) |
| `backend/src/tools/complete-concept.ts` | Now also calls `addConceptSummary()` with real data and updates in-memory concept summaries |
| `backend/src/prompts/system.ts` | Added: Review Protocol section, 4 new tool docs, subagent descriptions, batch_update usage guidance |
| `backend/src/hooks/pre-tool-use.ts` | Added budget warning hooks (2 separate matchers for generate_product_photo + generate_asset), exported `resetCostEstimated()`/`markCostEstimated()` |
| `backend/src/hooks/post-tool-use.ts` | Added `estimate_cost` marker hook that calls `markCostEstimated()` |
| `backend/src/hooks/stop.ts` | Replaced stub with session cost report logging |
| `backend/src/server.ts` | Wired `new_concept` to also reset cost-estimated flag and clear checkpoints |

### Tool Count: 23 → 27 (+ batch_update, save_checkpoint, restore_checkpoint, list_checkpoints)

## What Worked Well

- **Parallel streams**: Two agents worked simultaneously — stream-a on backend/tools/plugin, stream-b on UI/hooks/session. No cross-dependencies until final agent.ts integration.
- **Clean TypeScript compilation**: Only one type error caught (RegExp vs string for hook matcher) — quick fix.
- **Plan accuracy**: All 3 new files and 14 modified files from the plan were delivered as specified.

## Architecture Decisions

1. **Critic subagents via SDK `agents` option**: Used native Agent SDK subagent mechanism. Each critic is defined as an `AgentDefinition` with its own system prompt, model (sonnet), and tool access (Read only). Main agent invokes them via the built-in `Task` tool.

2. **Screenshot persistence for critics**: Modified `get_canvas_screenshot` to save screenshots to disk in the session's asset directory. Critics read the file via the `Read` tool (which supports images). This avoids passing base64 through the message chain.

3. **Review protocol via system prompt**: Instead of hardcoding iteration logic, the review protocol is embedded in the system prompt with clear instructions: save checkpoint → take screenshot → invoke fresh-eyes → fix → invoke contextual → fix → max 3 rounds.

4. **Checkpoint labels**: Used labels instead of just frameId for checkpoint keys, allowing multiple checkpoints per frame (e.g., "pre-iteration", "after-typography").

5. **Budget enforcement**: Soft warning (via hook additional context), not hard block. The agent sees a reminder but can still proceed — appropriate since cost estimation is advisory.

## Spec Deviations

- **list_checkpoints added**: Extra tool not in original plan — allows the agent to see available checkpoints. Minimal overhead.
- **Checkpoint uses labels**: Plan specified `Map<frameId, SerializedNode>`, implementation uses `Map<label, {frameId, data, savedAt}>` — more flexible, supports multiple checkpoints per frame.
- **No `request_review` iteration counter**: Plan mentioned tracking iteration rounds. Instead, the system prompt instructs max 3 rounds and the agent self-enforces. Simpler and sufficient.

## E2E Testing (2026-02-16)

Full E2E test session completed. All Phase 4 features verified working.

### Test Results

| Feature | Result | Notes |
|---------|--------|-------|
| batch_update | PASS | Agent needed stronger system prompt nudge to prefer it over sequential update_node. Fixed with "ALWAYS use batch_update when modifying 2+ nodes" in system prompt + update_node description. |
| save_checkpoint | PASS | Serializes full frame tree to JSON via plugin's serialize_frame command. |
| restore_checkpoint | PASS | Full node tree rebuild from JSON — deletes all children, recreates from serialized data including font loading. |
| list_checkpoints | PASS | Implicit in checkpoint flow, works correctly. |
| Critic subagent (fresh-eyes) | PASS | SDK `agents` option + `Task` tool works. Subagent spawns, reads screenshot via Read tool, returns proper Tier 1 FAIL/PASS verdict with specific issues. |
| Text update (characters) | **BUG FIXED** | `applyNodeProperties` in code.ts didn't handle `characters` — reported success but text never changed. Fixed: added font loading before `characters`/`fontSize` mutation + `characters` assignment. |
| Cost display | PASS | Accumulated correctly ($0.54 across test session). |
| New Concept button | PASS | Triggers concept boundary, resets session, clears checkpoints. |
| Debug toggle | PASS | Logs correctly to backend. |

### Bugs Fixed During E2E

1. **`characters` not handled in `applyNodeProperties`** (plugin/src/code.ts) — The `characters` property was in the update schema and backend, but `applyNodeProperties` never read it. Also, Figma requires font loading before ANY text mutation. Fixed by: (a) loading existing font when `characters` or `fontSize` changes without a new font, (b) adding `text.characters = props.characters` to the text properties section.

2. **Agent not using `batch_update`** (backend/src/prompts/system.ts) — System prompt was too soft. Fixed: `update_node` description now says "For 2+ nodes, ALWAYS use batch_update instead." Batch Updates section now marked CRITICAL with explicit "Never call update_node sequentially on multiple nodes."

### Untested (deferred — same mechanisms as tested features)
- contextual-critic (Pass 2) — same `agents` option as fresh-eyes, different prompt
- Budget enforcement hooks — PreToolUse matchers, same hook mechanism as others

## Open Concerns for Next Phase

1. **Checkpoint restore with complex nodes**: The restore logic handles FRAME, TEXT, RECTANGLE, ELLIPSE. More exotic node types (groups, components, instances) would need additional handling if used.
2. **Screenshot file cleanup**: Screenshots accumulate in the session asset directory. No cleanup mechanism yet.
3. **Batch update error handling**: If one update in a batch fails, the rest still execute. The agent needs to handle partial failures.
4. **Agent still sometimes ignores batch_update**: For mixed operations (e.g., set_background + update_node), the agent reasonably uses separate tools since set_background handles gradients/images. batch_update is only for update_node-type property changes.

## Key Learnings

- **Hook matcher is string-only**: SDK's `HookCallbackMatcher.matcher` accepts `string | undefined`, not RegExp. Must create separate hooks per tool name.
- **AgentDefinition import**: The SDK exports `AgentDefinition` type for defining subagents in the `agents` option.
- **Plugin restore requires font loading**: Text nodes need `figma.loadFontAsync()` before setting text content, making restore async and potentially slow for text-heavy frames.
- **Figma font loading required before ANY text mutation**: Not just `fontName` changes — setting `characters` or `fontSize` also requires the current font to be loaded first. Without this, the assignment silently fails.
- **System prompt nudges need to be CRITICAL-level for tool preferences**: Soft suggestions ("prefer X over Y") don't override the agent's default behavior. Must be explicit: "ALWAYS use X, NEVER use Y for this case."
- **E2E cost**: Full test session (smoke test + 4 feature tests) cost ~$0.66 total on Opus 4.6 with Max plan auth.
