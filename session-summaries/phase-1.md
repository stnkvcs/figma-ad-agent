# Phase 1 Session Summary — Foundation

**Date:** 2026-02-13
**Branch:** `feature/figma-plugin-agent`
**Status:** COMPLETE (E2E verified - agent creates frames in Figma via plugin)

---

## What Was Built

### Step 0: CLAUDE.md Update
- Added Session Operations section (before/during/after phase routine)
- Created `session-summaries/` directory

### Step 1: Shared Types (`shared/`)
- `protocol.ts` — All 4 message categories from spec: PluginCommand, PluginResponse, UIUpdate, UserAction
- `types.ts` — NodeInfo, SerializedNode (full recursive with paints/effects/auto-layout/text), SerializedPaint, SerializedEffect, CanvasState
- Type guards: `isPluginCommand()`, `isPluginResponse()`, `isUIUpdate()`, `isUserAction()`
- Compiles clean with TypeScript strict mode

### Step 2: Plugin Scaffold (`plugin/`)
- `manifest.json` — Figma plugin config (needs PLACEHOLDER_PLUGIN_ID replaced)
- `esbuild.config.mjs` — Dual build: code.ts → dist/code.js, ui.ts → inlined into dist/ui.html
- `code.ts` (451 lines) — Full Figma API executor:
  - Command dispatcher: createFrame, createText, createRectangle, createEllipse, getNodeById, updateNode, deleteNode, appendChild
  - `serializeNode()` recursive serializer with depth control
  - `serializePaint()` / `serializeEffect()` for fills/strokes/effects
  - `applyNodeProperties()` — unified property setter for all node types
  - `mapWeightToStyle()` — numeric font weight → Figma style name
  - Selection change relay, export, image data handling
  - All PluginCommand types handled (restore_checkpoint deferred)
- `ui.ts` (272 lines) — WebSocket client + message router:
  - WebSocket auto-reconnect with exponential backoff (2s→4s→8s→16s→30s)
  - Routes WS commands → postMessage to code.ts
  - Routes code.ts responses → WS back to backend
  - Chat rendering: agent messages, user messages, status, errors, thinking, cost
  - Selection tracking, user input with Enter/Shift+Enter
- `ui.html` — Minimal dark-theme chat UI with Figma CSS variables
- **Builds clean**: `npm run build` → dist/code.js + dist/ui.html

### Step 3: Backend Scaffold (`backend/`)
- `server.ts` (144 lines) — Express + WebSocket server:
  - Health check: GET /health → `{"status":"ok"}`
  - WebSocket: accepts plugin connections, routes messages to bridge
  - Model selection, brand selection, concept boundary, debug toggle handlers (Phase 1 stubs)
  - Localhost-only binding (127.0.0.1:3001)
- `bridge.ts` (159 lines) — Request/response correlation:
  - `sendCommand()` — UUID-based Promise tracking with 30s timeout
  - `handleResponse()` — resolves/rejects matching pending Promise
  - `sendUIUpdate()` — fire-and-forget UI streaming
  - `triggerUserMessage()` / `onUserMessage()` — user message routing
  - Cleanup on socket close
- `agent.ts` (175 lines) — Agent SDK integration:
  - Uses real SDK API: `tool()` positional, `createSdkMcpServer()`, `query({prompt, options})`
  - 3 custom tools: build_ad_skeleton, add_text, get_frame_state
  - Tool schemas use `.shape` extraction from z.object()
  - Tool handlers return MCP CallToolResult format
  - SDKMessage handling: assistant (BetaMessage content blocks), result (cost tracking)
  - systemPrompt, permissionMode, maxTurns, tools:[] (no built-in), allowedTools
- `tools/build-ad-skeleton.ts` — Creates frame with auto-layout, padding, safe zones
- `tools/add-text.ts` — Creates text node with font loading
- `tools/get-frame-state.ts` — Returns serialized frame state
- `tools/index.ts` — Tool registry
- `prompts/system.ts` — Minimal Phase 1 system prompt
- **Compiles clean**: `tsc --noEmit` → zero errors
- **Starts clean**: `npx tsx src/server.ts` → listening on 127.0.0.1:3001

### Step 4: Integration
- Fixed shared/ import paths (`.js` extension for NodeNext)
- Rewrote agent.ts with correct SDK API (9 corrections)
- All three packages compile/build clean
- Backend starts and serves health check

---

## Discoveries & Findings

### 1. Agent SDK API Surface (CRITICAL)
SDK v0.2.41 (`@anthropic-ai/claude-agent-sdk`) API differs significantly from documentation:
- `tool(name, desc, zodShape, handler)` — positional args, NOT object
- Tool schemas: raw Zod shapes via `z.object({...}).shape`, NOT `z.object()` directly
- Tool handlers: must return `CallToolResult` (`{ content: [{ type: 'text', text: '...' }] }`)
- `query({ prompt, options })` — prompt is string | AsyncIterable<SDKUserMessage>
- `mcpServers`: Record<string, Config> (keyed by name), NOT array
- No apiKey param — uses `process.env.ANTHROPIC_API_KEY`
- `systemPrompt`: string | { type: 'preset', preset: 'claude_code', append?: string }
- Query yields `SDKMessage` types: `'assistant'` (has `.message.content`), `'result'` (has `total_cost_usd`)
- SDK uses zod v4, depends on `@anthropic-ai/sdk` + `@modelcontextprotocol/sdk`
- `options.tools: []` disables all built-in tools (Bash, Read, etc.)
- `options.allowedTools` controls which MCP tools are auto-allowed (format: `mcp__{serverName}__{toolName}`)

### 2. Plugin Architecture Confirmed
- WebSocket MUST go in UI iframe (code.ts has no network)
- Communication: Backend → WS → ui.ts → postMessage → code.ts → figma.* → postMessage → ui.ts → WS → Backend
- esbuild inlines ui.ts JS into ui.html (Figma requires self-contained HTML)

### 3. Streaming Input for Multi-Turn (Phase 2 opportunity)
`AsyncIterable<SDKUserMessage>` as prompt parameter enables continuous conversation without sequential query() calls. Deferred to Phase 2 for proper implementation.

---

## Difficulties & Errors

1. **SDK API mismatch** — Backend-dev guessed the API instead of verifying. Required lead intervention to read actual .d.ts file and correct. Lesson: always `npm install` + read types BEFORE writing integration code.
2. **import type for runtime functions** — ui.ts used `import type` for type guard functions. Caught in code review, fixed.
3. **NodeNext module resolution** — shared/protocol.ts needed `.js` extension on relative imports. Quick fix.
4. **Figma sandbox doesn't support ES2020** — `??` operator caused syntax error. Fixed by targeting `es2017` in esbuild.
5. **networkAccess `["none"]` blocks WebSocket** — Plugin UI iframe needs `["*"]` to connect to localhost backend.
6. **CLAUDECODE=1 env var blocks nested SDK** — Agent SDK spawns Claude Code subprocess, which refuses to run inside another Claude Code session. Fix: unset `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` before starting backend. In production, backend runs independently (not from Claude Code terminal).

---

## Spec Deviations

1. **Checkpoint restore deferred** — `restore_checkpoint` handler is a stub ("Phase 2"). Plan already agreed to defer full rollback to Phase 4.
2. **Single query per message** — Phase 1 uses separate `query()` call per user message instead of streaming input AsyncIterable. Context is NOT preserved between messages. This is fine for Phase 1 proof of concept but must be addressed in Phase 2.
3. **No `.env` with real key** — Backend has .env.example but the .env with real ANTHROPIC_API_KEY needs to be created for live testing.

---

## Open Concerns for Next Phase

1. **Conversation context** — Current agent.ts creates a fresh query() per user message. No conversation history carried forward. Phase 2 must implement either AsyncIterable streaming input OR manual conversation history management.
2. **Live Figma E2E test** — Code compiles and backend starts, but the full pipeline (plugin → backend → agent → Figma frame creation) needs testing with:
   - Real Figma plugin ID in manifest.json
   - Real ANTHROPIC_API_KEY in .env
   - Plugin loaded in Figma dev mode
3. **SDKMessage handling completeness** — Current code handles 'assistant' and 'result' types. May need to handle 'system', partial messages, etc. for full streaming UX.
4. **Tool schema zod version** — Using `.shape` from z.object() works but is technically passing zod v3-style shapes to an SDK that uses zod v4 internally. Tested and works, but watch for edge cases.

---

## Key Learnings

1. **Always read the .d.ts file** — Documentation can be wrong or outdated. The actual TypeScript declarations are the source of truth for SDK APIs.
2. **SDK is Claude Code under the hood** — The Agent SDK spawns a Claude Code process. This means CLAUDE.md files in cwd, settings, hooks, etc. all apply. The `tools: []` option is needed to disable built-in tools.
3. **esbuild is the right choice for Figma plugins** — Fast, minimal config, handles the dual-build + HTML inlining pattern well.
4. **Bridge pattern works well** — UUID-based request/response correlation over WebSocket is clean and testable. The 30s timeout is a good safety net.
5. **Team workflow** — 3 parallel agents for scaffold tasks worked well. The blocker was SDK API verification — should have been a separate task before tool implementation.

---

## Files Created (20 source files)

```
figma-plugin/
├── CLAUDE.md                          ← Modified (Session Operations)
├── session-summaries/phase-1.md       ← This file
├── shared/
│   ├── package.json, tsconfig.json
│   ├── protocol.ts                    ← All WS message types + type guards
│   └── types.ts                       ← NodeInfo, SerializedNode, paints/effects
├── plugin/
│   ├── manifest.json, package.json, tsconfig.json
│   ├── esbuild.config.mjs            ← Dual build config
│   └── src/
│       ├── code.ts                    ← Figma API executor (451 lines)
│       ├── ui.ts                      ← WS client + message router (272 lines)
│       └── ui.html                    ← Chat UI (dark theme)
└── backend/
    ├── package.json, tsconfig.json, .env.example
    └── src/
        ├── server.ts                  ← Express + WS server (144 lines)
        ├── agent.ts                   ← Agent SDK integration (175 lines)
        ├── bridge.ts                  ← Request/response bridge (159 lines)
        ├── tools/
        │   ├── index.ts, build-ad-skeleton.ts, add-text.ts, get-frame-state.ts
        └── prompts/
            └── system.ts              ← Minimal Phase 1 prompt
```
