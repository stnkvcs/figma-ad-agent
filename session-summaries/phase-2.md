# Phase 2: Core Tools — Session Summary

**Date:** 2026-02-13
**Branch:** `feature/figma-plugin-agent`
**Status:** E2E VERIFIED — all 14 tools tested in live Figma

---

## What Was Built

### 13 new backend tool files:
1. **`tools/utils.ts`** — Shared helpers: hexToRgb/hexToRgba, readFileAsBase64, weightToStyle, snap8, rotationToGradientTransform
2. **`tools/set-background.ts`** — Solid, gradient (linear with transform matrix), image fill backgrounds
3. **`tools/add-effect.ts`** — Drop shadow, inner shadow, layer blur, background blur with sensible defaults
4. **`tools/apply-typography.ts`** — Multi-element text composition with role-based defaults, split-and-stack headlines
5. **`tools/get-canvas-screenshot.ts`** — Adaptive quality screenshots (draft 0.5x JPG / final 1x PNG), returns MCP image content for vision
6. **`tools/place-product.ts`** — Multi-step: read image → trim transparency with sharp → create frame → apply fill → position with presets
7. **`tools/image-analysis.ts`** — Sharp-based image processing: trimTransparentPixels, getImageDimensions
8. **`tools/raw-figma-operation.ts`** — Escape hatch with JSONL telemetry logging
9. **`tools/update-node.ts`** — Universal property modifier (position, size, colors, opacity, text, auto-layout)
10. **`tools/delete-node.ts`** — Remove nodes from canvas
11. **`tools/create-shape.ts`** — Rectangles/ellipses with styling and absolute positioning
12. **`tools/duplicate-frame.ts`** — Clone frames with automatic right-offset positioning
13. **`tools/export-ad.ts`** — Export frames as high-res PNG to disk (with ~ expansion)

### Also created:
- **`tools/FUTURE-TOOLS.md`** — Logged future tool ideas (place_image, create_container)

### Modified files:
1. **`tools/get-frame-state.ts`** — Added summary mode (compact text vs full JSON)
2. **`tools/index.ts`** — Exports all 14 tools + schemas + image utils
3. **`agent.ts`** — All 14 tools registered with optimized descriptions, conversation history via resume/sessionId, selection context injected into prompts, resetSession() export
4. **`prompts/system.ts`** — Expanded to ~140 lines: all 14 tools organized by category, workflow, design rules, anti-patterns, verification protocol
5. **`plugin/src/code.ts`** — Font fallback, clipsContent, parentId for createRectangle/createEllipse, layoutPositioning for all node types (not just frames), cloneNode handler
6. **`plugin/src/ui.ts` + `ui.html`** — Collapsible thinking sections

### New dependency:
- `sharp` v0.33.x — Native image processing for transparency trimming

---

## E2E Test Results (Live Figma)

All 14 tools verified working in live Figma plugin:
- `build_ad_skeleton` — frame creation with auto-layout
- `set_background` — solid + gradient fills
- `add_text` — single text nodes
- `apply_typography` — multi-element text + split-and-stack
- `add_effect` — drop shadows
- `get_frame_state` — structural inspection
- `get_canvas_screenshot` — vision-based verification (agent sees + describes)
- `place_product` — image with transparency trimming
- `raw_figma_operation` — escape hatch
- `update_node` — property modification
- `delete_node` — node removal
- `create_shape` — decorative shapes with absolute positioning
- `duplicate_frame` — frame cloning
- `export_ad` — PNG export to disk

**Conversation history** verified: agent maintains context across messages within a session.
**Selection context** verified: agent sees what's selected in Figma.

---

## Bugs Found & Fixed During Testing

### 1. CLAUDECODE env var conflict
Agent SDK spawns Claude Code subprocess which crashes when CLAUDECODE env vars are inherited.
**Fix:** Strip env vars when starting server: `env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT ... npx tsx src/server.ts`

### 2. MCP image content format
Screenshot tool returned wrong image format (nested `source` object vs flat `data`/`mimeType`).
**Fix:** Use flat MCP format `{ type: 'image', data, mimeType }`.

### 3. Selection not passed to agent
UI attached selection to messages, but agent.ts only sent `action.content` as prompt.
**Fix:** Build prompt string with selection context appended when available.

### 4. Shapes not appended to parent
`createRectangle`/`createEllipse` handlers in code.ts didn't handle `parentId` — shapes were orphaned.
**Fix:** Added parentId handling (same pattern as createFrame/createText).

### 5. layoutPositioning only on FRAME nodes
`layoutPositioning: 'ABSOLUTE'` was inside the FRAME-only block in applyNodeProperties, so shapes couldn't be absolutely positioned.
**Fix:** Moved layoutPositioning handling before the FRAME-only block — applies to any node.

### 6. ~ not expanded in export path
Node.js `writeFileSync` doesn't expand `~`. Agent used `~/Desktop/...` but file went to literal `~` directory.
**Fix:** Resolve `~` to `homedir()` in export-ad.ts.

---

## Architecture Decisions

- **Pre-trim strategy**: `sharp(buffer).trim()` on backend before sending to Figma (simpler than post-placement analysis)
- **MCP image content for screenshots**: agent uses vision to inspect its own work
- **Conversation history via resume**: SDK's `resume` option with stored `sessionId`
- **Split-and-stack headlines**: wrapper frame with one text node per line, tight itemSpacing
- **Optimized tool descriptions**: each description starts with WHEN to use, distinguishes from similar tools

---

## File Inventory

```
backend/src/
├── agent.ts                     (14 tools, conversation history, selection context)
├── prompts/
│   └── system.ts                (~140 lines, all design rules)
└── tools/
    ├── utils.ts                 (shared helpers)
    ├── set-background.ts        (backgrounds)
    ├── add-effect.ts            (effects)
    ├── apply-typography.ts      (multi-element text)
    ├── get-canvas-screenshot.ts (visual verification)
    ├── place-product.ts         (image pipeline)
    ├── image-analysis.ts        (sharp processing)
    ├── raw-figma-operation.ts   (escape hatch + telemetry)
    ├── update-node.ts           (property modifier)
    ├── delete-node.ts           (node removal)
    ├── create-shape.ts          (decorative shapes)
    ├── duplicate-frame.ts       (frame cloning)
    ├── export-ad.ts             (PNG export to disk)
    ├── get-frame-state.ts       (summary + full modes)
    ├── index.ts                 (all exports)
    └── FUTURE-TOOLS.md          (place_image, create_container)

plugin/src/
├── code.ts                      (font fallback, clipsContent, parentId for shapes, layoutPositioning for all nodes, cloneNode)
├── ui.ts                        (collapsible thinking)
└── ui.html                      (thinking CSS)
```

**Total tool count:** 14 (was 3 in Phase 1)
**Total source files:** 33 (was 20 in Phase 1)
**Test session cost:** ~$0.60 for 16 queries

---

## Open Concerns for Phase 3

1. **Session persistence across server restarts**: sessionId is in-memory, lost on restart
2. **Gradient transform math**: needs visual verification — Figma's gradient transform is finicky
3. **Large images over WebSocket**: 5-10MB products → 7-14MB base64, untested at scale
4. **Agent sometimes struggles with multi-step iteration**: create_shape test showed agent going in circles before fix

---

## Next Phase (Phase 3: Intelligence)

Per spec:
- System prompt with brand data injection (read_brand_data tool)
- Ad library browsing with thumbnails (browse_ad_library tool, SQLite)
- Concepts-log integration (read + auto-write)
- Angle index (angles.md, auto-maintained)
- Quality gate hooks (PreToolUse for tier 1 checks)
- Asset generation (fal.ai integration, fire-and-continue)
- Context management with concept boundaries
- Per-concept cost tracking
