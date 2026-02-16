# Phase 3a: Intelligence Core — Session Summary

**Date:** 2026-02-13 (code), 2026-02-16 (E2E verified)
**Branch:** `feature/figma-plugin-agent`
**Commit:** `9d7a788`
**Status:** COMPLETE — E2E verified. All 4 intelligence tools + hooks tested live in Figma.

## What Was Built

Phase 3a makes the agent design-aware and data-driven. Added 4 new tools, expanded system prompt with design knowledge, wired hooks infrastructure, and added session state management.

### New Files (12)

| File | Lines | Purpose |
|------|-------|---------|
| `backend/src/prompts/design-rules.ts` | 136 | Creative hierarchy (L1/L2/L3), format categories (10), archetypes, copy rules, product photography, borrowed interfaces, concept questions, variety audit |
| `backend/src/tools/read-brand-data.ts` | 163 | Read brand files (overview, specs, concepts-log, learnings) or list directory. Path traversal security. `_global` for cross-brand. |
| `backend/src/tools/browse-ad-library.ts` | 171 | SQLite queries + base64 thumbnail images for reference browsing. Cached connection. |
| `backend/src/tools/complete-concept.ts` | 52 | Log completed ad: L1 angle + L2 format + L3 execution to concepts-log + angle index |
| `backend/src/tools/log-learning.ts` | 75 | Append design learnings to brand-specific or universal file |
| `backend/src/data/concepts-log.ts` | 65 | Read/write `brands/{brand}/ads/concepts-log.md` |
| `backend/src/data/angle-index.ts` | 111 | Read/write `brands/{brand}/ads/angles.md` with angle section parsing |
| `backend/src/hooks/index.ts` | 27 | Central hook registry: `buildHooks()` |
| `backend/src/hooks/pre-tool-use.ts` | 32 | Quality gate on `export_ad` — injects Tier 1 checklist |
| `backend/src/hooks/post-tool-use.ts` | 11 | Stub for Phase 3b async asset delivery |
| `backend/src/hooks/stop.ts` | 18 | Session end logging |
| `backend/src/session-state.ts` | 62 | Module-level brand/product state, set on `brand_selected` |

### Modified Files (6)

| File | Changes |
|------|---------|
| `backend/src/prompts/system.ts` | Import design-rules, add Intelligence Tools docs (4 tools), add Ideation Workflow (6 steps) |
| `backend/src/tools/index.ts` | Export 4 new tools + schemas |
| `backend/src/agent.ts` | Register 4 new tools, wire hooks via `buildHooks()`, 14→18 tools, version 0.2.0→0.3.0 |
| `backend/src/server.ts` | Import `setSessionState` + `resetSession`, implement `brand_selected` and `new_concept` handlers |
| `backend/package.json` | Add `better-sqlite3` + `@types/better-sqlite3` |
| `figma-plugin/spec.md` | Split Phase 3 into Phase 3a (Intelligence Core) and Phase 3b (Asset Pipeline + Context) |

### New Dependency
- `better-sqlite3` ^11.0.0 (synchronous SQLite for ad library queries)
- `@types/better-sqlite3` ^7.6.8

## Architecture Decisions

1. **System prompt ~300 lines always-loaded** — Creative hierarchy and format categories needed for every interaction. ~4K token overhead is acceptable.
2. **Concept logging via explicit tool, not Stop hook** — `complete_concept` fires per-concept with metadata. Stop hook fires once per session.
3. **Quality gate as context injection** — PreToolUse on `export_ad` injects Tier 1 checklist via `additionalContext`. Agent self-evaluates via vision.
4. **4 new tools don't need Bridge** — They read filesystem/SQLite directly. No Figma API calls.
5. **Session state in module scope** — `setSessionState()` on brand selection, tools read via `getSessionState()`.

## Team Execution

Used 3 parallel teammates (user-requested team approach):
- **prompt-builder**: design-rules.ts + system.ts expansion
- **data-tools**: read-brand-data.ts + browse-ad-library.ts
- **tracking-hooks**: concepts-log.ts + angle-index.ts + complete-concept.ts + log-learning.ts + all hooks files

Lead handled: session-state.ts, .env config, package.json, spec.md update, final wiring (agent.ts + server.ts), compilation check.

## What Works Well
- Clean separation: data tools (filesystem), design tools (Bridge), hooks (context injection)
- `readBrandData` and `browseAdLibrary` return ToolResult directly (text + image content blocks)
- Hooks infrastructure is extensible — Phase 3b just adds to the arrays

## E2E Test Results (2026-02-16)

All Phase 3a features tested live in Figma — everything passed:
- **Brand selection** — `brand_selected` → `setSessionState()` works
- **`read_brand_data`** — reads brand specs, concepts-log, learnings from filesystem
- **`browse_ad_library`** — SQLite queries + base64 thumbnail delivery confirmed
- **`complete_concept`** — writes to concepts-log.md + angles.md
- **`log_learning`** — appends to learnings files
- **PreToolUse hook** — quality gate checklist injection on `export_ad` confirmed

## Open Concerns for Phase 3b
- Session state isn't persisted to disk — server restart loses brand selection
- fal.ai TypeScript client (asset generation) deferred to Phase 3b
- Concept boundary pruning deferred to Phase 3b

## Next: Phase 3b (Asset Pipeline + Context)
- `generate_product_photo` tool (fal.ai Edit API, TypeScript native)
- `generate_asset` tool (fal.ai T2I API)
- PostToolUse hook for async asset delivery
- Concept boundary pruning
- Cost estimation per concept
- File-backed session persistence
