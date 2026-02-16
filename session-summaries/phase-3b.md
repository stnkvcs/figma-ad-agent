# Phase 3b: Asset Pipeline + Context Management — Session Summary

**Date:** 2026-02-16
**Branch:** `feature/figma-plugin-agent`
**Status:** COMPLETE — TypeScript compiles clean. Needs E2E verification with live fal.ai calls.

## What Was Built

Phase 3b gives the agent the ability to **generate images** (product photos, assets, backgrounds) and manage **multi-concept sessions** with persistence. The agent can now go from ideation to finished ad without leaving the plugin.

### New Files (7)

| File | Lines | Purpose |
|------|-------|---------|
| `backend/src/fal-client.ts` | 127 | fal.ai SDK singleton, file upload (with cache + HTTP fallback), image download. Lazy FAL_KEY check. |
| `backend/src/tools/generate-product-photo.ts` | 119 | Nano Banana Pro Edit API: prompt + 1-12 reference images → product photo. Optional bg removal. REALISM_SUFFIX auto-appended. |
| `backend/src/tools/generate-asset.ts` | 127 | Nano Banana Pro T2I API: prompt + type → background/UI/prop/texture/person. Type-specific prompt prefixing. |
| `backend/src/tools/remove-background.ts` | 58 | Bria RMBG 2.0: standalone background removal for existing images. Saves with `_nobg` suffix. |
| `backend/src/tools/estimate-cost.ts` | 69 | Per-concept cost estimation: product photos ($0.12), assets ($0.06), bg removal ($0.03) + agent inference ($5-10). |
| `backend/src/session-persistence.ts` | 196 | File-backed session state: JSON to `data/sessions/{sessionId}.json`. CRUD + concept summaries + asset manifest + cost tracking. |
| `backend/.env.example` | Updated | Added FAL_KEY documentation. |

### Modified Files (7)

| File | Changes |
|------|---------|
| `backend/package.json` | Added `@fal-ai/client: ^1.9.1` |
| `backend/src/tools/index.ts` | Exports 4 new tools (23 total) |
| `backend/src/agent.ts` | Registered 4 new tools, added to allowedTools (23 entries), version 0.4.0, cost accumulation in session state, concept summary injection into dynamic system prompt |
| `backend/src/server.ts` | Wired session persistence on brand_selected, concept boundary on new_concept (builds ConceptSummary, persists, resets SDK session), clearSessionState on disconnect |
| `backend/src/session-state.ts` | Expanded interface (sessionId, conceptSummaries[], totalCost), file-backed persistence via session-persistence.ts, server restart recovery via listSessions(), new exports: getSessionId(), getAssetOutputDir(), addSessionCost() |
| `backend/src/hooks/post-tool-use.ts` | Replaced stub: cost reporting after generate_product_photo, generate_asset, remove_background. Injects running cost + placement reminder. |
| `backend/src/prompts/system.ts` | Documented 4 new tools (asset generation section), updated workflow to 8 steps (added cost estimation + asset generation phases), renumbered tool list to 23. |

### Architecture Decisions

1. **Synchronous generation for v1** — fal.ai takes 5-15s, tolerable within agent turn time. Async (PostToolUse notification queue) is stubbed but deferred to Phase 4. The async upgrade path is designed in: tools return taskId field, PostToolUse hook structure supports queue checking.

2. **Official `@fal-ai/client` v1.9.1** — Named export `{ fal }`, `fal.subscribe()` returns `Result<T>` = `{ data: T, requestId: string }`. SDK upload via `fal.storage.upload(blob)` with raw HTTP fallback.

3. **Tools return file paths** — Agent calls `place_product` or `set_background` separately. Maximum flexibility (agent decides placement, can review before placing).

4. **Lazy FAL_KEY check** — Server starts even without FAL_KEY (warns). Throws only when generation tools are actually called. Prevents crash for design-only sessions.

5. **Concept boundaries** — Reset SDK session (clear `currentSessionId`) + inject previous concept summaries into dynamic system prompt. No manual conversation pruning needed.

6. **File-backed session persistence** — `data/sessions/{sessionId}.json` stores brand/product/model, concept summaries, asset manifest, cost. Server restart recovery via `listSessions()` → load most recent.

## What Worked Well

- **Team parallelization** — Two sonnet teammates (asset-tools, session-mgmt) worked independently on Streams A and B while lead handled integration (Stream C). All stream-A tasks completed before stream-B finished, no blocking.
- **Clean TypeScript compile** — Zero errors after all modifications. Zod v4 schemas, ES module imports, consistent patterns.
- **fal.ai SDK types** — `Result<T>` = `{ data: T, requestId }` confirmed from `node_modules` type declarations. No guessing.
- **Reference pattern** — `place-product.ts` served as THE template for new generation tools (file I/O, error handling, structured return).

## What Didn't Work / Surprises

- **fal.ai import style** — `@fal-ai/client` exports `fal` as a named export (`import { fal }`), not namespace (`import * as fal`). Initial code had wrong import, caught by linter.
- **Eager FAL_KEY throw** — Initial fal-client.ts threw on import if FAL_KEY missing, which would crash the entire server. Fixed to lazy warning + throw-on-use.

## Spec Deviations

1. **Fire-and-continue deferred** — Spec calls for async PostToolUse notification pipeline. Implemented as synchronous for v1 (simpler, 5-15s is tolerable). PostToolUse hook exists but only reports cost, doesn't poll async queue. Designed for Phase 4 upgrade.
2. **Concept boundary summaries are minimal** — The `new_concept` handler in server.ts builds a ConceptSummary with empty fields (angle, formatCategory, etc.) because this data lives in the agent's conversation, not in server state. The `complete_concept` tool populates the concepts-log directly. Future improvement: have complete_concept also update the session's concept summary.

## Open Concerns for Next Phase

| Concern | Impact | Suggested Fix |
|---------|--------|---------------|
| **Concept summaries are empty shells** | new_concept creates ConceptSummary with empty strings. Agent's complete_concept writes to concepts-log but doesn't update session state. | Have complete_concept also call addConceptSummary with real data. |
| **No asset verification** | generate_product_photo doesn't verify generated product against reference. Spec says this is Tier 1. | Add visual comparison (sharp perceptual hash or dimension check) in Phase 4. |
| **No budget enforcement** | Cost is tracked and displayed but never blocks. Agent can exceed budget. | Add PreToolUse hook that blocks generation tools when budget exceeded. |
| **fal.ai SDK upload in Node.js** | Uses `new Blob([buffer])` which works in Node 18+ but may have edge cases. HTTP fallback exists. | Monitor for upload failures in E2E testing. |
| **Session cleanup** | Old session files accumulate in data/sessions/. No TTL or cleanup. | Add session archival/cleanup on server start or periodic timer. |

## Key Learnings

- `@fal-ai/client` v1.9.1: `fal.subscribe()` returns `{ data: T, requestId: string }` — confirmed from type declarations
- fal.ai Edit API endpoint: `fal-ai/nano-banana-pro/edit`, T2I: `fal-ai/nano-banana-pro`, bg removal: `fal-ai/bria/background/remove`
- Upload: `fal.storage.upload(blob)` works with Node.js `new Blob([buffer])`. Fallback: POST to `rest.alpha.fal.ai/storage/upload/initiate` + PUT bytes.
- Agent SDK hooks: PostToolUse fires after tool execution, can inject `additionalContext` string into agent context via `hookSpecificOutput`

## Tool Count

**23 tools total:**
- 15 design tools (Phase 1-2)
- 4 intelligence tools (Phase 3a)
- 4 asset generation tools (Phase 3b)

## Cost / Performance

- Session: ~25 minutes, 3 agents (lead + 2 sonnet teammates)
- Teammates completed 8 tasks in parallel, lead handled 4 integration tasks
- Zero type errors on final compile

## E2E Test Results (2026-02-16)

| # | Test | Result | Notes |
|---|------|--------|-------|
| 1 | `generate_product_photo` with real Feno reference | PASS | File saved to data/assets/. ~2min total (includes bg removal agent added on its own). |
| 2 | `generate_asset` (background type) | PASS | Dark moody gradient generated, placed on canvas. |
| 3 | `remove_background` standalone | SKIPPED | Agent auto-removed bg during test 1 (set removeBg: true without being asked). Standalone path not tested separately. |
| 4 | Full pipeline: generate → place on canvas → screenshot | PASS (implicit) | Agent placed both generated assets on canvas during tests 1-2. |
| 5 | `estimate_cost` | PASS | Returned reasonable breakdown before concept build. |
| 6 | Session persistence (server restart) | PASS | Killed server, restarted. Session file preserved brand=feno, product=smartbrush, cost=$1.07. Agent remembered context on reconnect. |
| 7 | Concept boundary | PARTIAL | Agent started fresh concept (borrowed interface) with cost estimate + approval flow. No "New Concept" button in UI — used chat text. Did not verify concept summary injection (ran out of time). |
| 8 | Cost tracking accumulation | PASS (implicit) | Cost accumulated across multiple generation calls, visible in session file and chat UI. |

### First Full Autonomous Ad Build

The agent built a complete **Feno — Health Blind Spot — Borrowed Interface** ad autonomously:
- Health App UI with Heart (72 BPM), Sleep (7h 12m), Steps (8,432) cards
- "Oral Health: No Data" highlighted card with orange border (the provocation)
- Headline: "You track everything. Except your mouth." (italic)
- Hand-held product photo at bottom
- Dark background, proper spacing, correct frame naming

**Quality:** Genuinely good concept. Sharp angle, well-executed borrowed interface. Passes the 0.5s test.

### Issues Found During E2E

1. **Agent plan drift** — Estimated "no product photo needed, will reuse existing asset" then immediately generated one anyway. `estimate_cost` is informational only, doesn't constrain subsequent tool calls.

2. **Auto bg-removal without request** — Agent set `removeBg: true` on `generate_product_photo` without being asked. Tool default is `false`. Agent inferred it from design rules in system prompt. Not a bug but overly proactive for testing.

3. **No batch tool** — Agent made 11 sequential `update_node` calls to center text in cards. Had all values calculated in one thought but had to drip-feed them. Same for `add_text` (3 calls per card section). Highest-impact improvement for Phase 4.

4. **Generation speed** — ~2min for product photo with bg removal. Breakdown: upload (~15s) + Edit API (~45-60s) + re-upload for bg removal (~10s) + bg removal (~15-30s) + downloads. Without bg removal should be ~45-60s.

5. **No "New Concept" button in UI** — Spec section 7.1 shows it but never built. User had to type in chat. Works but not discoverable.

6. **Concept boundary not fully verified** — Agent started a new concept correctly but we didn't verify the summary injection into system prompt or the session file update.

### Phase 4 Priority List (from E2E feedback)

1. **Batch operations tool** — `batch_update` accepting array of `{nodeId, props}`. Cuts 10+ sequential calls to 1. Highest impact on speed + cost.
2. **Agent plan enforcement** — PreToolUse hook comparing generation calls against last estimate, or system prompt reinforcement.
3. **"New Concept" UI button** — Trivial to add, important for UX.
4. **Two-pass critic** — Not tested yet, core Phase 4 deliverable per spec.
5. **Checkpoint rollback** — Not tested yet, Phase 4 per spec.
6. **complete_concept → session summary** — Fill real data into concept summaries.
