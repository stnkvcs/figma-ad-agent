# Figma Plugin Agent — Architecture Spec

> **Status:** Complete. All architectural decisions finalized via interview session (2026-02-13). Ready for implementation.

---

## 1. Problem Statement

The current ad design system operates from the terminal (Claude Code) and bridges to Figma via a WebSocket channel:

```
Claude Code (terminal) → MCP Server → WebSocket → Channel ID → Figma Plugin
```

**Pain points:**
- **Channel fragility** — Channel IDs change between sessions. Connections drop. Manual reconnection required.
- **Low-level tools** — 35+ generic Figma MCP tools (create_frame, set_fill, move_node...). The agent makes 30-50 tool calls per ad, fighting abstractions. Every call's result pollutes context.
- **Context bloat** — ~90 tools loaded into every conversation (Figma + Pencil + skill-seeker + icons8 + native). Irrelevant tools waste tokens.
- **MCP translation layer** — The MCP server translates between Claude's tool calls and Figma's API. Edge cases cause bugs we've had to document and work around (11 patterns in patterns.md, 6 logged MCP issues).
- **Multi-agent overhead** — Team-based workflow (lead + designer + critic + asset specialist) introduces message relay lag, idle loops, communication failures. In practice, one agent does 90% of the design work.

**What works well (and must be preserved):**
- Design principles and creative philosophy (CLAUDE.md, .claude/rules/)
- Quality gate system (tier 1/2/3 checklists)
- Brand data structure (specs, concepts-logs, learnings)
- Ad library reference system (2,637 images, 82 categories)
- Three-tier learning system (learnings, MCP issues, patterns)
- Asset generation pipeline (fal.ai / Nano Banana Pro)

---

## 2. Solution

Build a Figma plugin powered by the Claude Agent SDK. The agent lives inside Figma — no terminal, no channel bridge.

```
┌──────────────────────────────────┐
│  Figma Plugin (TypeScript)       │
│  ┌────────────────────────────┐  │
│  │ UI Panel (chat-first)      │  │
│  │ - Brand/product dropdown   │  │
│  │ - Chat interface (80%)     │  │
│  │ - Collapsible agent thought│  │
│  │ - Cost status bar          │  │
│  │ - Debug toggle             │  │
│  └────────────────────────────┘  │
│  ┌────────────────────────────┐  │
│  │ Figma API Executor (thin)  │  │
│  │ - Receives commands via WS │  │
│  │ - Calls figma.* API        │  │
│  │ - Returns results + errors │  │
│  │ - Frame serializer (JSON)  │  │
│  │ - Selection event relay    │  │
│  │ - Command queue (parallel) │  │
│  └────────────────────────────┘  │
└──────────────┬───────────────────┘
               │  WebSocket (localhost, no auth, auto-reconnect)
┌──────────────▼───────────────────┐
│  Node.js Backend (Agent SDK)     │
│                                  │
│  Main Agent (configurable model) │
│  ├─ System prompt:               │
│  │   Design rules, brand data,   │
│  │   quality gates, ad library   │
│  ├─ High-level tools (~10):      │
│  │   build_ad_skeleton()         │
│  │   place_product()             │
│  │   apply_typography()          │
│  │   set_background()            │
│  │   add_effect()                │
│  │   get_canvas_screenshot()     │
│  │   get_frame_state()           │
│  │   generate_product_photo()    │
│  │   generate_asset()            │
│  │   read_brand_data()           │
│  │   browse_ad_library()         │
│  │   raw_figma_operation()       │
│  ├─ Hooks:                       │
│  │   PreToolUse: safety checks   │
│  │   PostToolUse: logging +      │
│  │     async asset check         │
│  │   Stop: final quality gate    │
│  ├─ Critic (two-pass review):    │
│  │   Pass 1: fresh-eyes (Sonnet) │
│  │   Pass 2: contextual (Sonnet) │
│  ├─ Asset specialist (Sonnet):   │
│  │   Fire-and-continue pipeline  │
│  ├─ Cost tracking: per-concept   │
│  ├─ Context management:          │
│  │   Concept boundary pruning    │
│  ├─ Session persistence:         │
│  │   Resumable conversations     │
│  └─ Tool evolution telemetry     │
│                                  │
│  Data access (filesystem):       │
│  ├─ Brand specs                  │
│  ├─ Concepts-log + angle index   │
│  ├─ Learnings                    │
│  ├─ Ad library (SQLite + files)  │
│  └─ Template library (JSON idx)  │
└──────────────────────────────────┘
```

### Why this architecture:

- **No channel IDs** — Plugin connects to YOUR backend on launch. Reconnects automatically. No manual step.
- **High-level tools** — Instead of 35 generic tools, ~12 domain-specific tools. Each encodes multiple Figma API calls internally. Fewer agent turns = less cost, less context pollution, fewer mistakes.
- **Direct Figma API** — Plugin calls `figma.createFrame()`, `figma.createText()`, etc. natively. No MCP translation layer. No edge case bugs.
- **patterns.md absorbed** — The 11 documented MCP workarounds become internal tool logic. "Always use auto-layout" isn't a prompt instruction — it's how `build_ad_skeleton()` works by default.
- **Simpler agent topology** — One main agent with critic + asset specialist as subagents, not a 4-agent team with message relay.
- **Self-improving** — Generic escape-hatch tool usage is tracked and auto-promoted to defined tools when patterns emerge.

---

## 3. Technology Stack

| Component | Technology | Why |
|-----------|-----------|-----|
| **Figma Plugin** | TypeScript | Figma plugin standard. Runs in sandboxed VM. |
| **Plugin UI** | HTML + CSS (Figma plugin UI) | showUI() renders an iframe. Can use framework (Preact/Svelte) if needed. |
| **Backend** | Node.js + TypeScript | Agent SDK is TypeScript. Same language as plugin. |
| **Agent SDK** | `@anthropic-ai/claude-agent-sdk` | Claude Code engine as a library. Subagents, hooks, MCP, streaming, cost tracking. |
| **Transport** | WebSocket (ws) | Bidirectional, low-latency. Backend ↔ Plugin. Localhost only. |
| **Image generation** | fal.ai (Nano Banana Pro) | Existing pipeline. Edit API for product photos, T2I for assets. |
| **Brand data** | Filesystem (same structure as current) | Backend has Node.js filesystem access. Cloud migration → e2b or similar. |
| **Ad library** | SQLite + filesystem | Existing 2,637-image library with metadata DB. |
| **Template library** | JSON index + Figma frames | Self-building. Agent creates templates from completed ads. |

---

## 4. Key Decisions

### 4.1 Agent architecture: one main agent, model-configurable

**Current:** 4-agent team (lead + designer + critic + asset specialist) with TeamCreate, SendMessage, TaskCreate orchestration.

**New:** One main agent that handles ideation + design. Model is configurable per session:
- **Opus 4.6** — Default. Best creative quality.
- **Opus 4.5** — Cheaper, still strong.
- **Sonnet 4.5** — Budget mode. Good for template-based builds where creative heavy-lifting is minimal.

User selects model in plugin UI. Can change between concepts.

**Subagents:**
- **Asset specialist** (Sonnet) — Image generation, verification, background removal. Fire-and-continue async pipeline.
- **Critic** (Sonnet) — Two-pass quality gate review. Always runs on every concept.

**Future (Phase 5):** Parallel mode — 4 independent full agent instances building 4 concepts simultaneously. NOT subagents — full orchestrator instances, each with their own conversation and tool access. Requires command queue multiplexer in plugin.

### 4.2 High-level, domain-specific tools + escape hatch

**Current:** 35+ generic Figma MCP tools. Agent must know HOW to compose them (patterns.md).

**New:** ~14 tools — 10 high-level domain tools + 2 batch tools (see §4.15) + 1 escape hatch + 1 canvas inspection:

| Tool | What it does internally | Agent sees |
|------|------------------------|-----------|
| `build_ad_skeleton(format, dimensions, safeZones)` | Creates frame, sets auto-layout, padding, safe zone markers | Frame ID |
| `place_product(frameId, imagePath, position, scale)` | Creates image frame, set_image_fill, trim_to_content, position, resize | Node ID + bounds |
| `apply_typography(frameId, headline, subhead, style)` | Creates text nodes, loads fonts, sets sizes, split-and-stack for tight spacing | Text node IDs |
| `set_background(frameId, type, config)` | Solid, gradient, image fill, pattern | Applied |
| `add_effect(nodeId, type, config)` | Drop shadow, blur, with sensible defaults | Applied |
| `get_canvas_screenshot(nodeId, options)` | Exports node as PNG. Adaptive quality: 0.5x JPEG during build, 1x PNG for final QA | Image data |
| `get_frame_state(frameId)` | Returns JSON: all nodes with positions, sizes, colors, text content | Structured state |
| `generate_product_photo(prompt, references)` | Calls fal.ai, verifies result, optionally removes background. Fire-and-continue. | Task ID (async) or image path |
| `generate_asset(prompt, type)` | Calls fal.ai T2I for non-product assets. Fire-and-continue. | Task ID (async) or image path |
| `read_brand_data(brand, file)` | Reads from brands/{brand}/ filesystem | File content |
| `browse_ad_library(categories, count)` | Queries SQLite, returns actual thumbnail images to agent | Image data + metadata |
| `raw_figma_operation(method, args)` | Escape hatch. Any Figma API call. Telemetry-tracked for tool promotion. | Raw result |

Each high-level tool encodes the patterns we've learned:
- `place_product()` always trims transparent images, starts at 60-80% frame size
- `build_ad_skeleton()` always uses auto-layout with proper padding and 8px grid
- `apply_typography()` uses split-and-stack for tight line-height, numeric font weights
- `generate_product_photo()` verifies against reference before returning

### 4.3 Tool evolution pipeline

The `raw_figma_operation()` escape hatch is telemetry-tracked:

1. Backend logs every `raw_figma_operation` call with: method, args, context (what the agent was trying to do)
2. An automatic threshold (5+ uses of the same pattern across sessions) triggers a tool definition draft
3. Draft saved to `backend/src/tools/_drafts/` with usage examples
4. Developer reviews and merges into a defined tool

This is the three-tier learning system applied to tool evolution. The agent's workarounds become first-class tools over time.

### 4.4 Checkpoint system for tool rollback

Figma has no transactions. High-level tools encode 5-15 Figma API calls each. When a tool fails mid-execution:

**Strategy: Full recursive serialization.**

1. Before each high-level tool executes, the plugin serializes the target frame's entire node tree to JSON (recursive, all descendants)
2. Serialization includes: node types, positions, sizes, properties, fills/strokes/effects, auto-layout settings, text content, image hashes (references, not raw bytes)
3. If the tool fails mid-execution, the backend sends a `restore_checkpoint` command
4. Plugin deletes the current frame subtree and rebuilds from the serialized JSON
5. Image hashes are re-applied (Figma retains image data by hash within a session)

**Plugin is a thin executor** — all errors bubble back to the backend/agent. The plugin doesn't retry or handle fallbacks. The checkpoint system is the safety net.

### 4.5 Hooks for quality gates + async assets

Agent SDK hooks (programmatic TypeScript):

| Hook | Trigger | Action |
|------|---------|--------|
| `PreToolUse` on completion tool | Agent tries to mark ad as done | Run tier 1 checklist programmatically: safe zones, text sizes, spacing. Block if any fail. |
| `PostToolUse` on design tools | After any canvas modification | 1. Log operation for audit trail. 2. Check async asset queue — if pending assets are ready, inject notification into agent context ("Asset ready: product_hero.png"). Agent decides placement. |
| `Stop` | Agent conversation ends | Final cost report, auto-update concepts-log + angle index. Prompt user about template creation. |

**Async asset integration:** The PostToolUse hook checks the asset pipeline after every design tool call. If an image is ready, it injects a message into the agent's context. The agent stays in creative control of placement — the hook just delivers the notification, doesn't place automatically.

### 4.6 Two-pass critic review

Every completed concept gets two review passes:

**Pass 1: Fresh-eyes (separate agent invocation)**
- Input: Screenshot only + brand spec + quality gates checklist
- NO conversation history, NO concept brief
- Evaluates: Tier 1 (product accuracy, headline, spacing, legibility, safe zones, image integration)
- True blind review — catches what the designer can't see because they're too close

**Pass 2: Contextual (subagent with conversation access)**
- Input: Screenshot + brand spec + quality gates + concept brief + angle definition
- Has full context of what was intended
- Evaluates: Tier 2 (dynamic shots, backgrounds, variety, brand consistency) + concept alignment
- Judges whether the execution serves the angle

**Scoring:**
- FAIL: any Tier 1 fail (pass 1), OR 3+ Tier 2 fail (pass 2), OR concept alignment < 7/10
- PASS: all Tier 1 pass AND 3/4+ Tier 2 pass AND concept alignment 7+/10

**Iteration limit: 3 rounds (hard).** After 3 fix rounds, agent presents result as-is with remaining issues noted. User decides whether to intervene manually or accept.

### 4.7 System prompt = design rules

The agent's system prompt loads:
- Parent `.claude/rules/` content (creative hierarchy, design system, execution, quality gates)
- Brand-specific data (loaded dynamically via `read_brand_data()` tool)
- Concepts-log context (recent ads, format tally, variety audit)
- Angle index (explored angles, their format usage, completeness)
- Relevant learnings from `.claude/taste/learnings.md`

### 4.8 Plugin ↔ Backend protocol

WebSocket messages between plugin and backend. Typed protocol:

```typescript
// ─── Backend → Plugin (commands) ───

type PluginCommand =
  | { type: 'figma_call'; id: string; method: string; args: any[] }
  | { type: 'export_node'; id: string; nodeId: string; format: 'PNG' | 'SVG' | 'JPG'; scale: number }
  | { type: 'get_state'; id: string }
  | { type: 'serialize_frame'; id: string; frameId: string }
  | { type: 'restore_checkpoint'; id: string; frameId: string; serialized: SerializedNode }
  | { type: 'get_selection'; id: string }
  | { type: 'image_data'; id: string; base64: string; targetNodeId: string; scaleMode: string }

// ─── Plugin → Backend (responses) ───

type PluginResponse =
  | { type: 'result'; id: string; data: any }
  | { type: 'error'; id: string; error: string }
  | { type: 'selection_changed'; nodes: NodeInfo[] }
  | { type: 'page_changed'; pageId: string }

// ─── Backend → Plugin (streaming UI updates) ───

type UIUpdate =
  | { type: 'agent_text'; content: string }
  | { type: 'agent_thinking'; content: string }       // collapsible in UI
  | { type: 'tool_start'; tool: string; input: any }
  | { type: 'tool_result'; tool: string; summary: string }
  | { type: 'cost_update'; spent: number; budget: number }
  | { type: 'status'; phase: string; message: string }
  | { type: 'error_friendly'; message: string }        // user-facing
  | { type: 'error_debug'; message: string; raw: any } // debug toggle

// ─── Plugin → Backend (user actions) ───

type UserAction =
  | { type: 'user_message'; content: string; selection?: NodeInfo[] }
  | { type: 'brand_selected'; brand: string; product: string }
  | { type: 'new_concept'; }                            // concept boundary
  | { type: 'model_selected'; model: 'opus-4.6' | 'opus-4.5' | 'sonnet-4.5' }
  | { type: 'debug_toggle'; enabled: boolean }
```

### 4.9 Image transfer

Images (product photos, generated assets, screenshots) are sent as **base64 over WebSocket**. No separate HTTP endpoint. Trade-off: 33% size overhead, but simpler architecture — one transport channel for everything. Typical image (2-5MB) becomes 3-7MB base64, which WebSocket handles without issue on localhost.

### 4.10 Streaming UX

**Raw speed** — no artificial pacing. Operations fire as fast as the agent decides. Elements appear on canvas near-instantly. The "building" experience comes from:

1. Status messages in chat: "Building skeleton..." → "Applying typography..." → "Placing product..."
2. Agent thinking shown in collapsible sections (expandable by user)
3. Real-time cost updates in the status bar
4. The canvas itself — user sees elements appear in real-time since Figma renders immediately

### 4.11 Context management: concept boundaries

The Agent SDK conversation runs through the Claude API — same context window limits apply. Strategy:

**Concept boundaries:** User explicitly starts a new concept (button in UI or "new concept" in chat). When triggered:

1. Current concept's conversation gets compressed to a structured summary:
   - Angle definition
   - Format category used
   - Key creative decisions
   - Final result (frame ID, screenshot reference)
   - Issues encountered and resolved
2. Summary replaces the full conversation history
3. System prompt + brand context + summaries of ALL previous concepts persist
4. New concept starts with fresh context for the design work

Within a concept, full conversation context is preserved. This lets the agent reference earlier decisions and iterate naturally.

### 4.12 Session persistence

**Resumable sessions.** Backend persists:
- Agent conversation messages (JSON)
- Concept summaries (from boundary pruning)
- Current brand/product selection
- Angle index state
- Pending async assets

On plugin reconnect (reopen, Figma restart, sleep/wake), the backend restores the session. Agent continues from where it left off with full context.

Session state stored in: `backend/data/sessions/{sessionId}.json`

### 4.13 User interaction model: parallel chat

User can type messages at any time during agent execution. Messages are handled as:

1. Message queues until current tool call completes (~1-2 seconds typical)
2. Agent sees the message on its next turn
3. Agent processes it naturally — adjusts course, responds, continues

No mid-tool interruption. No pausing. The delay between tool calls is short enough that it feels responsive. Like texting someone who's actively working — they read and respond within seconds.

Selection context is included passively: when the user sends a message, the current Figma selection is attached as context. The agent knows what's selected but doesn't react to selection changes proactively.

### 4.14 Canvas management

Each concept is a **new top-level frame on the same Figma page**. Frames are positioned to the right of previous ones with consistent padding. Named descriptively: `{Brand} — {Angle} — Concept {N} ({Format})`.

Example canvas layout:
```
[Sintra — Time Theft — C1 (Editorial)]  [Sintra — Time Theft — C2 (Borrowed Interface)]  [Sintra — Time Theft — C3 (Provocation)]
```

### 4.15 Batch operation system

Building an ad requires 6-10 sequential high-level tool calls, each a model round trip (~2-3s API latency). For the initial build where the agent knows what it wants, these round trips are pure waste. Two batch tools eliminate this — inspired by Pencil MCP's `batch_design`.

#### `batch_pipeline` — chain high-level tools (happy path, 80% of builds)

Chains existing high-level tools with variable binding. The agent writes a pipeline, backend executes sequentially, resolves `$ref` dependencies between steps, returns one combined result.

```json
{
  "pipeline": [
    {
      "id": "skeleton",
      "tool": "build_ad_skeleton",
      "args": { "format": "story", "dimensions": { "width": 1080, "height": 1920 } }
    },
    {
      "id": "typo",
      "tool": "apply_typography",
      "args": { "frameId": "$skeleton.frameId", "headline": "Finally.", "headlineFontSize": 300 }
    },
    {
      "id": "bg",
      "tool": "set_background",
      "args": { "frameId": "$skeleton.frameId", "type": "gradient", "config": { "stops": ["#0a0a0a", "#1a1a2e"] } }
    },
    {
      "id": "product",
      "tool": "place_product",
      "args": { "frameId": "$skeleton.frameId", "imagePath": "/path/to/hero.png", "position": "center-bottom" }
    },
    {
      "tool": "get_canvas_screenshot",
      "args": { "nodeId": "$skeleton.frameId" }
    }
  ]
}
```

How it works:
1. Backend saves a checkpoint before executing the pipeline
2. Executes each step sequentially, storing results keyed by `id`
3. Resolves `$id.field` references in subsequent steps' args (deep resolution — works in nested objects)
4. If any step fails: stops, rolls back to checkpoint, returns partial results + error
5. Returns combined summary: each step's key outputs, final screenshot if included

What the agent can pipeline: any tool that doesn't require creative judgment based on intermediate visual results. In practice: skeleton → typography → background → product placement → effects → screenshot. Asset generation is excluded (async, fire-and-continue).

**Typical build: 6 tool calls → 1 tool call. ~12-15s API latency → ~2-3s.**

#### `batch_operations` — low-level Figma DSL (fine control, 20% of builds)

For custom work where high-level tools are too opinionated. A compact script DSL for raw Figma operations with variable binding:

```
frame=CREATE_FRAME(null, { width:1080, height:1920, fillColor:"#0a0a0a", layoutMode:"VERTICAL", paddingTop:80 })
headline=CREATE_TEXT($frame, { characters:"Finally.", fontSize:300, fontWeight:400, fontColor:"#FFFFFF" })
sub=CREATE_TEXT($frame, { characters:"2 minutes of you.", fontSize:48, fontColor:"#FFFFFF80" })
rect=CREATE_RECT($frame, { width:800, height:4, fillColor:"#FFFFFF20" })
product=CREATE_FRAME($frame, { width:800, height:800 })
SET_IMAGE_FILL($product, { imagePath:"/path/to/hero.png", scaleMode:"FILL" })
TRIM($product)
UPDATE($headline, { layoutSizingHorizontal:"FILL", textAutoResize:"HEIGHT" })
```

Available operations:
| Operation | Syntax | Maps to |
|-----------|--------|---------|
| Create frame | `var=CREATE_FRAME(parentId, props)` | `figma.createFrame()` + properties |
| Create text | `var=CREATE_TEXT(parentId, props)` | `figma.createText()` + font load + properties |
| Create rectangle | `var=CREATE_RECT(parentId, props)` | `figma.createRectangle()` + properties |
| Set image fill | `SET_IMAGE_FILL(nodeId, props)` | Image decode + fill application |
| Trim transparent | `TRIM(nodeId)` | Trim to content bounds |
| Update properties | `UPDATE(nodeId, props)` | Property application |
| Set gradient | `SET_GRADIENT(nodeId, props)` | Gradient fill application |
| Add effect | `ADD_EFFECT(nodeId, props)` | Effects application |
| Delete node | `DELETE(nodeId)` | Node removal |
| Reparent | `REPARENT(nodeId, newParentId, index)` | Move in tree |

Rules:
- `null` as parent = current page (top-level frame)
- `$varName` references a previously created node's ID
- Props use the same property names as `batch_update` (fillColor, fontColor, fontSize, etc.)
- Operations execute sequentially, top to bottom
- On failure: stop, return partial results with created node IDs + error at failed line
- Max 50 operations per call
- All pattern workarounds are embedded: fonts auto-load before text ops, trim auto-runs for transparent images when flagged

**Use cases:** borrowed interfaces with custom chrome, complex layouts that don't fit the high-level tool structure, iterative refinements that touch many nodes at once.

#### When agent uses which:

| Scenario | Tool | Why |
|----------|------|-----|
| Initial ad build (standard) | `batch_pipeline` | Known structure, high-level tools handle patterns |
| Initial ad build (exotic layout) | `batch_operations` | Need fine control over node structure |
| Iteration after critic review | Individual tools | Targeted fixes, need to see each change |
| Custom UI chrome (borrowed interface) | `batch_operations` | Many small elements, precise positioning |
| Refinement pass (spacing, colors) | `batch_update` (existing) | Property updates on existing nodes |

#### Telemetry

Both batch tools are tracked by the tool evolution pipeline:
- `batch_operations` patterns that repeat across sessions get promoted to high-level tool drafts (same 5+ threshold as `raw_figma_operation`)
- `batch_pipeline` step sequences that repeat suggest new composite tools

### 4.16 API-level features

| Feature | How it applies |
|---------|---------------|
| **Tool Search** | Manage tool sets per phase. Skeleton phase loads layout tools. Paint phase loads style tools. Fewer tools = better accuracy per phase. |
| **Batch Operations** | Two-tier batching: `batch_pipeline` chains high-level tools, `batch_operations` scripts raw Figma operations. Both eliminate model round trips. |
| **Tool Use Examples** | Embedded directly in tool schemas. More token-efficient than loading patterns.md as context. |
| **Fine-grained Streaming** | Stream tool inputs to plugin UI for real-time "what the agent is thinking" display. |

---

## 5. Workflow: Angle-Based Concept Sessions

### 5.1 The 4-concept-per-angle model

The standard workflow produces **4 distinct concepts per angle**:
- Each concept uses a **different L2 format category** (hard constraint)
- Same L1 angle, different L2 format, unique L3 execution
- Example: "Parents have no time" angle → Editorial + Borrowed Interface + Provocation + Comparison

### 5.2 Session flow

**1. Plugin open → Brand selector**
Plugin opens showing brand/product dropdown. User selects. Agent loads context and greets with a summary: recent angles, concepts built, variety gaps from concepts-log + angle index.

**2. Angle definition**
User provides or co-develops an angle with the agent. Agent registers it in memory.

**3. Format planning**
Agent proposes 4 format categories for the angle, checking:
- Angle index (which formats were used in previous angles)
- Concepts-log (recent format usage across all angles)
- Format-angle fit (does this format serve this angle well?)

**4. Concept building (sequential in v1)**
For each concept:
- Agent ideates L3 execution within the assigned format
- Browses ad library (actual thumbnails sent to agent) for references
- Fires async asset generation (product photos, props)
- Builds layout skeleton immediately (doesn't wait for assets)
- Continues building (typography, background, effects)
- Assets arrive via PostToolUse hook → agent places them
- Two-pass critic review
- Fix iterations (max 3 rounds)
- Auto-log to concepts-log + angle index
- Prompt user: "Save as template?"

**5. Concept boundary**
Context pruned. Summary preserved. Next concept starts fresh.

**6. Session end**
All concepts logged. Learnings captured. Templates created if approved.

### 5.3 Parallel mode (Phase 5, future)

4 independent full agent instances building simultaneously:
- Meta-orchestrator assigns angle + format per instance
- Each instance is a complete agent (own conversation, own tools, configurable model)
- Plugin command queue uses **round-robin multiplexer** — one command from each agent in rotation
- Canvas regions pre-allocated (each concept gets its own x-range)
- All 4 concepts progress at roughly equal speed

### 5.4 Angle index

Maintained per brand at `brands/{brand}/ads/angles.md`:

```markdown
# Angle Index

## Time Theft (2026-02-13)
- Status: Complete (4/4 concepts)
- Concepts:
  1. Editorial — "2 Minutes of You" — dark, text-heavy, intimate
  2. Borrowed Interface — IG Story timer, morning routine
  3. Provocation — "Your toothbrush doesn't care"
  4. Comparison — Split: morning chaos vs calm routine
- Revisits: 1 (2026-02-15) — Data/Stats + Narrative + UGC + Feature Callout

## Clean Obsession (2026-02-14)
- Status: In progress (2/4 concepts)
- Concepts:
  1. PR/Media — "Dentist-approved" article snippet
  2. Social Proof — Quote collage
```

Tracks: which angles exist, which formats have been used per angle, and supports multiple visits to the same angle with different format assignments.

---

## 6. Self-Building Template Library

### 6.1 Concept

After completing an ad, the agent can templatize it:
1. Duplicate the completed ad frame
2. Strip brand-specific content: replace product with gray placeholder, genericize text ("Headline Here", "Body text placeholder"), neutralize colors to grayscale
3. Preserve: layout structure, auto-layout settings, spacing, safe zones, composition
4. Save as template frame on a dedicated "Templates" page in the Figma file

### 6.2 Template index

Backend maintains a JSON index for fast browsing:

```json
{
  "templates": [
    {
      "id": "tmpl_001",
      "figmaFrameId": "123:456",
      "formatCategory": "Borrowed Interface",
      "layout": "centered-card-with-chrome",
      "textNodes": 3,
      "productPlacement": "center-bottom",
      "screenshotPath": "templates/screenshots/tmpl_001.png",
      "createdFrom": "Sintra — Time Theft — C2",
      "createdAt": "2026-02-13"
    }
  ]
}
```

### 6.3 Template usage

1. Agent browses template index (JSON + screenshots) via `browse_ad_library` or a dedicated `browse_templates` tool
2. Selects best-fit template for current concept
3. Copies the actual Figma frame from Templates page into working area
4. Agent manually rebrands: swaps colors, fonts, text, product. Full creative control during rebranding — no automated transform.

### 6.4 Compounding value

After 20 ads → 20 templates. After 50 → 50. Each new concept starts from a proven layout instead of blank canvas. Speed compounds. Quality compounds (templates preserve good spatial decisions).

---

## 7. Plugin Design

### 7.1 UI layout (chat-first)

```
┌──────────────────────────────┐
│ [Brand ▼] [Product ▼] [⚙️]  │  ← Compact top bar
│ [Model: Opus 4.6 ▼]         │
├──────────────────────────────┤
│                              │
│  Agent: Ready. Last session  │
│  for Sintra: 2 concepts on   │
│  "Time Theft" angle.         │
│  ▶ Thinking...               │  ← Collapsible
│                              │
│  Agent: Building skeleton    │
│  for 1080x1920 editorial...  │
│                              │
│  Agent: Typography applied.  │
│  ▶ Reasoning...              │  ← Collapsible
│                              │
│  [Cost: $3.20 / est. $5-8]  │  ← Inline cost
│                              │
│  Agent: Concept complete.    │
│  Save as template? [Yes][No] │
│                              │
├──────────────────────────────┤
│ [Type a message...]    [Send]│  ← Always visible
│ [New Concept]                │  ← Concept boundary trigger
└──────────────────────────────┘
```

**Space allocation:**
- Top bar: ~60px (brand/product/model dropdowns, settings gear)
- Chat area: ~80% of remaining space (scrollable)
- Input area: ~60px (always pinned to bottom)
- Cost display: inline in chat, not a separate bar

**Debug toggle** (⚙️ menu): When enabled, shows raw errors, WS message log, agent reasoning without collapsing. Default: off.

### 7.2 First-open experience

1. Plugin opens → brand/product selector is prominent
2. User selects brand + product
3. Backend loads brand context (specs, concepts-log, angle index, learnings)
4. Agent greets with context summary: recent angles, variety gaps, suggestions
5. User starts chatting or types an angle

### 7.3 Brand switching

Switching brands triggers a **hard reset**: fresh conversation, new agent context, brand-specific system prompt loaded. Previous brand conversation is archived (session persistence) but not carried forward.

### 7.4 Figma selection integration

**Passive awareness.** Plugin tracks Figma selection via `figma.on('selectionchange', ...)`. Current selection is attached to each user message as context:

```typescript
{ type: 'user_message', content: 'make this bigger', selection: [{ id: '123:456', type: 'TEXT', name: 'Headline', fontSize: 64 }] }
```

Agent knows what's selected when the user asks a question. No proactive reactions to selection changes — no "I see you selected the headline" interruptions.

---

## 8. Error Handling

### 8.1 Plugin is a thin executor

All errors from Figma API calls bubble back to the backend as-is. The plugin does NOT:
- Retry failed operations
- Handle font fallbacks
- Recover from partial failures

The backend/agent handles all error recovery logic.

### 8.2 Error display: verbose toggle

**Default (friendly mode):**
- User sees: "Could not load font PP Editorial New. Using fallback."
- Internal errors logged silently
- Agent handles retries without bothering user

**Debug mode (toggle in settings):**
- Raw error messages displayed
- WebSocket traffic visible
- Agent reasoning shown expanded by default
- Figma API call log visible

### 8.3 Checkpoint rollback on tool failure

When a high-level tool fails mid-execution (e.g., `place_product` fails at step 5 of 8):

1. Backend catches the error
2. Sends `restore_checkpoint` command to plugin
3. Plugin rebuilds the frame from the serialized JSON snapshot taken before the tool started
4. Backend reports the error to agent
5. Agent can retry with different parameters or take a different approach

---

## 9. Asset Pipeline

### 9.1 Fire-and-continue model

Asset generation is async. The agent doesn't block waiting for images:

1. Agent calls `generate_product_photo()` or `generate_asset()`
2. Tool immediately returns a task ID and placeholder frame ID
3. Agent creates a placeholder frame on canvas and continues building (layout, typography, etc.)
4. Backend starts fal.ai generation in background
5. PostToolUse hook checks the asset queue after every design tool call
6. When an image is ready, the hook injects a message: "Asset ready: task_xyz, path: /tmp/product_hero.png"
7. Agent processes the notification on its next turn — decides where/how to place the image
8. Agent stays in creative control of placement (not automated)

### 9.2 Image transfer

Base64 over WebSocket. Backend reads the generated image, base64-encodes it, sends via WS to plugin. Plugin decodes, creates a Figma image, applies as fill.

For adaptive screenshots:
- During build: 0.5x scale, JPEG quality 80 → ~200-500KB
- Final quality gate: 1x scale, PNG → ~2-4MB

---

## 10. Data Management

### 10.1 Filesystem direct

Backend reads/writes brand data using Node.js `fs`. Same directory structure as current system:

```
brands/{brand}/
├── brand/                    # Brand spec files
├── products/{product}/
│   ├── spec.md
│   ├── learnings.md
│   └── assets/
├── ads/
│   ├── concepts-log.md
│   └── angles.md            # NEW: angle index
ad-library/
├── _index/
│   ├── library.db            # SQLite
│   └── thumbnails/{category}/
└── {category}/
```

No abstraction layer. If this goes to cloud, the backend moves to e2b or similar service with built-in filesystem support.

### 10.2 Concepts-log updates: automatic

After each concept completes and passes review, the backend auto-appends to `concepts-log.md`:
- L1 angle, L2 format, L3 execution
- Product position, shot type, background treatment
- References used
- Cost

### 10.3 Angle index: automatic

After each concept, the backend auto-updates `angles.md`:
- Track angle status (in progress / complete)
- List concepts with format + brief description
- Track revisits (same angle, different session)

### 10.4 Template creation: user-prompted

After concept completion, agent asks "Save as template?" in chat. If yes:
- Duplicates frame to Templates page
- Strips brand content to grayscale placeholders
- Updates template JSON index on backend filesystem

### 10.5 Learnings: automatic observation + prompt

Agent auto-captures session observations to concepts-log Learnings section. If the agent identifies a potentially universal design principle, it prompts the user: "I noticed [X]. Worth adding to cross-brand learnings?"

---

## 11. What Transfers from Current System

### Direct transfer (no changes):
- `brands/` directory structure — specs, concepts-logs, learnings, assets
- `ad-library/` — 2,637 reference images + SQLite index
- `.claude/rules/creative-hierarchy.md` — format categories, archetypes, copy rules
- `.claude/rules/design-system.md` — 8px grid, typography, color, composition
- `.claude/rules/execution.md` — safe zones, spacing, image integration, backgrounds
- `.claude/rules/quality-gates.md` — tier checklists, anti-patterns, variety audit
- `.claude/taste/learnings.md` — cross-brand design learnings
- Asset generation scripts (Nano Banana Pro) — used by backend tools

### Absorbed into tool implementations:
- `.claude/rules/patterns.md` — 11 MCP workarounds → internal tool logic
- `.claude/hooks/checklists/designer.md` — quality checklist → PreToolUse hook logic
- `.claude/hooks/checklists/critic.md` — review framework → critic prompts (two-pass)
- `.claude/hooks/checklists/asset-specialist.md` — verification steps → asset tool logic

### Eliminated:
- `.claude/knowledge/mcp-issues.md` — No more MCP translation layer. You write the tools.
- `.claude/hooks/teammate-idle.sh` — No more idle loop hack. SDK hooks are first-class.
- `.claude/rules/team-roles.md` — Simplified to one agent + subagents. Role definitions embedded in subagent configs.
- Channel bridge / TalkToFigma MCP server — Replaced by direct plugin ↔ backend WebSocket.

### Reimagined:
- `.claude/rules/ad-library.md` — Browsing process becomes a tool (`browse_ad_library()`) with actual thumbnails sent to agent.
- CLAUDE.md workflow phases — Absorbed into agent's system prompt and tool orchestration.
- Brand-scoped `angles.md` — NEW. Tracks angle exploration across sessions.

### New:
- Self-building template library (JSON index + Figma frames)
- Tool evolution pipeline (raw_figma_operation → defined tools via automatic threshold)
- Context management with concept boundaries
- Resumable sessions

---

## 12. Figma Plugin API — Key Capabilities

Official docs: https://developers.figma.com/docs/plugins/

### What the plugin can do (relevant to our tools):

**Node creation:** `figma.createFrame()`, `figma.createText()`, `figma.createRectangle()`, `figma.createEllipse()`, `figma.createImage(data)`, `figma.createImageAsync(url)`, `figma.createNodeFromSvg(svg)`

**Node properties:** Position (x, y), size (width, height), fills, strokes, effects, corner radius, auto-layout (layoutMode, itemSpacing, padding, primaryAxisAlignItems, counterAxisAlignItems, layoutSizingHorizontal/Vertical), text content, font loading (`figma.loadFontAsync()`), opacity, rotation, constraints, blendMode

**Node access:** `figma.getNodeByIdAsync(id)`, `figma.currentPage`, `figma.root`, selection

**Export:** `node.exportAsync({ format, constraint })` — exports node as PNG/SVG/PDF/JPG bytes

**UI:** `figma.showUI(html, options)` — renders plugin panel. Communication via `figma.ui.postMessage()` and `figma.ui.onmessage`.

**Events:** `figma.on('selectionchange', cb)`, `figma.on('currentpagechange', cb)`, `figma.on('documentchange', cb)`

**Fonts:** `figma.loadFontAsync({ family, style })` — MUST be called before setting text content. Lazy-loaded on first use with similar-family fallback if unavailable.

**Images:** `figma.createImage(bytes)` returns an Image object with `hash`. Apply as fill: `node.fills = [{ type: 'IMAGE', imageHash: hash, scaleMode: 'FILL' }]`

**Serialization (for checkpoints):** Plugin can traverse node tree recursively, extract all properties, and serialize to JSON. Restoration re-creates nodes and re-applies properties including image hashes (Figma retains image data by hash within a session).

**Limitations:**
- No filesystem access
- No shell/process execution
- No direct HTTP from plugin sandbox code (use UI iframe for fetch)
- Font loading is async and required before text manipulation
- Limited to current file (no cross-file operations)
- Single-threaded — commands from multiple backend agents must be queued

---

## 13. Implementation Phases

### Phase 1: Foundation
- Figma plugin scaffold (manifest, UI panel with brand selector + chat, Figma API executor)
- Backend scaffold (Express + WebSocket server, Agent SDK setup)
- Plugin ↔ Backend WebSocket protocol (typed, bidirectional, auto-reconnect)
- Frame serialization/deserialization (checkpoint system)
- One working tool: `build_ad_skeleton()` — agent creates a frame with auto-layout in Figma
- One read tool: `get_frame_state()` — agent can inspect what's on canvas
- Proof of concept: agent can create a frame, add text, and read the result back

### Phase 2: Core Tools
- Implement all high-level design tools (skeleton, typography, background, effects, product placement)
- `raw_figma_operation()` escape hatch with telemetry logging
- Image pipeline (base64 transfer, create image from bytes, apply as fill, trim)
- Font lazy-loading with fallback
- Screenshot export (adaptive quality: low-res build, high-res QA)
- `get_frame_state()` structured canvas inspection
- Chat UI with collapsible thinking sections

### Phase 3a: Intelligence (Core)
- System prompt expansion with design rules (port from .claude/rules/ — creative hierarchy, format categories, composition, variety audit)
- Brand data loading (`read_brand_data` tool, filesystem)
- Ad library browsing with actual thumbnails (`browse_ad_library` tool, SQLite + base64 images)
- Concepts-log integration (`complete_concept` tool — agent calls after each concept to log L1/L2/L3 metadata)
- Angle index (new `angles.md` file, maintained via `complete_concept` tool)
- Quality gate hooks (PreToolUse on `export_ad` — Tier 1 checklist injection)
- Hook infrastructure (PreToolUse, PostToolUse stub, Stop)
- Session state management (brand/product tracking on `brand_selected`)
- `log_learning(text, scope, category)` tool — direct chat command for recording design principles

### Phase 3b: Asset Pipeline + Context
- Asset generation tools (`generate_product_photo`, `generate_asset`) — TypeScript fal.ai client
- Fire-and-continue async pipeline with PostToolUse hook delivery
- Context management with concept boundaries (conversation pruning to summaries)
- Per-concept cost estimation and tracking
- Principle surfacing — agent proposes universal learnings when it notices reusable patterns

### Phase 4: Review & Iteration
- Two-pass critic review (fresh-eyes + contextual)
- Iteration flow (critic → fix → re-review, max 3 rounds)
- Checkpoint rollback on tool failure
- Session persistence / resume
- Verbose toggle for debug mode
- Streaming UX refinement (status messages, cost display)
- Passive selection awareness

### Phase 5a: Batch Operations + Tool Intelligence
- **Batch pipeline tool** (`batch_pipeline`) — chain high-level tools with variable binding, auto-checkpoint, combined results. Reduces 6-10 API round trips to 1 for initial builds.
- **Batch operations tool** (`batch_operations`) — compact Figma DSL for fine-grained multi-node creation/manipulation in a single call. Variable binding, sequential execution, embedded pattern workarounds.
- Tool evolution pipeline (automatic threshold promotion from `raw_figma_operation` AND `batch_operations` patterns)
- Template library (auto-templatize, JSON index, browse + copy)

### Phase 5b: Parallel + Polish
- Parallel concept generation (4 independent agents, round-robin command queue)
- Model selection per concept
- Plugin UI polish

---

## 14. Cost Model

### Per-concept estimate

Before each concept, the agent estimates cost based on:
- Selected model (Opus 4.6 ~$5-10, Opus 4.5 ~$3-7, Sonnet 4.5 ~$1-3)
- Number of asset generations needed (~$0.10-0.50 per image via fal.ai)
- Library browsing (5-8 thumbnails ~$0.50-1.00 in vision tokens)
- Two-pass critic (~$0.50-1.00)
- Screenshots during build (~$0.20-0.50 adaptive)

User sees estimate in chat: "This concept will cost approximately $5-8." User approves before building.

Running total visible in the UI status bar throughout the session.

### Typical session cost

| Mode | Per concept | Per angle (4 concepts) | Per session |
|------|-----------|----------------------|-------------|
| **Opus 4.6** | $5-10 | $20-40 | $20-80 |
| **Opus 4.5** | $3-7 | $12-28 | $12-56 |
| **Sonnet 4.5** | $1-3 | $4-12 | $4-24 |

---

## 15. Security & Deployment

### Local-only, no auth

Backend listens on `127.0.0.1` only. No external connections possible. No authentication layer. API keys (Anthropic, fal.ai) stored in backend `.env` file.

Plugin connects to `ws://localhost:{PORT}` on launch.

### Server lifecycle

Manual start: `npm run dev` in backend directory before opening plugin. Server runs in terminal. Plugin connects on open, reconnects on drop.

### Dev loop

Manual reload. Change code → re-run plugin from Figma menu. ~5-10 second cycle. No hot reload investment for v1.

### Plugin distribution

Dev mode only (private). Load from local manifest during development. Organization distribution or Figma Community publication are future considerations, not v1.

---

## 16. References

| Resource | URL |
|----------|-----|
| Claude Agent SDK Overview | https://platform.claude.com/docs/en/agent-sdk/overview |
| Agent SDK TypeScript | https://platform.claude.com/docs/en/agent-sdk/typescript |
| Agent SDK TypeScript v2 | https://platform.claude.com/docs/en/agent-sdk/typescript-v2-preview |
| Agent SDK Headless Mode | https://code.claude.com/docs/en/headless |
| Agent SDK Streaming | https://platform.claude.com/docs/en/agent-sdk/streaming-output |
| Agent SDK Hooks | https://platform.claude.com/docs/en/agent-sdk/hooks |
| Agent SDK System Prompts | https://platform.claude.com/docs/en/agent-sdk/modifying-system-prompts |
| Agent SDK MCP | https://platform.claude.com/docs/en/agent-sdk/mcp |
| Agent SDK Custom Tools | https://platform.claude.com/docs/en/agent-sdk/custom-tools |
| Agent SDK Subagents | https://platform.claude.com/docs/en/agent-sdk/subagents |
| Agent SDK Skills | https://platform.claude.com/docs/en/agent-sdk/skills |
| Agent SDK Cost Tracking | https://platform.claude.com/docs/en/agent-sdk/cost-tracking |
| Figma Plugin Docs | https://developers.figma.com/docs/plugins/ |
| Figma Plugin API Reference | https://developers.figma.com/docs/plugins/api/figma/ |
| Advanced Tool Use (Anthropic) | https://www.anthropic.com/engineering/advanced-tool-use |
| Fine-grained Tool Streaming | https://platform.claude.com/docs/en/agents-and-tools/tool-use/fine-grained-tool-streaming |
| Parent project design rules | `../.claude/rules/` (7 files, ~2,200 lines) |
| Parent project brand data | `../brands/` (6 brands, concepts-logs, specs) |
| Parent project ad library | `../ad-library/` (2,637 images, 82 categories, SQLite index) |
