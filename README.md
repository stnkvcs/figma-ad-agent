# Autonomous Ad Agent

A Figma plugin powered by Claude Opus 4.6 that designs static ads autonomously. You describe an angle, it builds the ad — typography, layout, product placement, backgrounds, effects — all inside Figma, in real time.

No terminal. No copy-paste. No manual Figma operations. You chat, the agent builds.

https://github.com/user-attachments/assets/placeholder-demo-video

---

## The Problem

Professional ad design is locked behind three barriers:

1. **Expertise** — Years of training in composition, typography, color theory, and brand systems
2. **Cost** — Design agencies charge $100-500+ per ad concept. A DTC brand running 10 angles needs $5,00-2,5000.
3. **Speed** — A senior designer takes 2-4 hours per polished ad concept. An agency takes days.

AI image generators (Midjourney, DALL-E) can make pretty pictures, but they can't design *ads*. An ad needs structure: safe zones, typography hierarchy, product placement, brand consistency, and a concept that stops someone mid-scroll. That requires design *thinking*, not just image generation.

## The Solution

An AI agent that lives inside Figma and designs ads like a senior creative director would:

- **Understands ad design** — 2,200+ lines of design rules (8px grid, typography hierarchy, safe zones, composition) baked into its system prompt
- **Has 32 specialized tools** — Not generic "create rectangle" calls. Domain tools like `build_ad_skeleton`, `apply_typography`, `place_product` that encode proven design patterns
- **Generates assets on the fly** — Product photos and visual assets via fal.ai, with automatic background removal
- **Reviews its own work** — Two-pass critic system: a blind visual quality check + a concept-aware creative review
- **Learns and improves** — Logs design learnings, builds a template library from completed ads, tracks escape-hatch tool usage to evolve new tools automatically
- **Keeps you in the loop** — You chat, approve concepts, guide creative direction. The agent amplifies your judgment, it doesn't replace it.

---

## Architecture

```
Figma Plugin (TypeScript)                    Node.js Backend
+--------------------------+                +----------------------------------+
|                          |                |                                  |
|  UI Panel (chat-first)   |   WebSocket    |  Claude Agent SDK (Opus 4.6)     |
|  - Brand/product picker  | <-----------> |  - 32 custom design tools        |
|  - Chat interface        |   localhost    |  - 2 critic subagents (Sonnet)   |
|  - Cost tracking         |               |  - Quality gate hooks            |
|  - Debug toggle          |                |  - Session persistence           |
|                          |                |                                  |
|  Figma API Executor      |                |  Data Layer                      |
|  - Receives commands     |                |  - Brand specs (filesystem)      |
|  - Calls figma.* API     |                |  - Ad library (SQLite + images)  |
|  - Returns results       |                |  - Template library (JSON index) |
|  - Frame serializer      |                |  - fal.ai (image generation)     |
+--------------------------+                +----------------------------------+
```

The plugin is a **thin executor** — it receives commands over WebSocket and calls Figma's native API. All intelligence lives in the backend. The agent thinks, the plugin draws.

---

## Tools (32 total)

### Design Tools (15)
| Tool | What It Does |
|------|-------------|
| `build_ad_skeleton` | Creates the root frame with auto-layout, padding, safe zones |
| `apply_typography` | Multi-element text composition with smart sizing and split-and-stack |
| `set_background` | Solid colors, gradients, or full-bleed images |
| `add_effect` | Drop shadows, blur, background blur |
| `place_product` | Image placement with auto-trim, scaling, position presets |
| `add_text` | Single text nodes with full font control |
| `update_node` | Modify any property on any existing node |
| `batch_update` | Update multiple nodes in a single round-trip |
| `create_shape` | Rectangles, ellipses, decorative elements |
| `delete_node` | Remove nodes from canvas |
| `reorder_children` | Control z-order (layer stacking) |
| `duplicate_frame` | Clone frames for variations |
| `export_ad` | Export finished ads as high-res PNGs |
| `get_frame_state` | Inspect canvas structure (summary or full JSON) |
| `get_canvas_screenshot` | Visual screenshot for self-evaluation |

### Intelligence Tools (4)
| Tool | What It Does |
|------|-------------|
| `read_brand_data` | Load brand specs, concepts-log, product data |
| `browse_ad_library` | Query 2,637 reference ads with actual thumbnails |
| `complete_concept` | Log finished concepts (L1 angle, L2 format, L3 execution) |
| `log_learning` | Record reusable design principles |

### Asset Generation Tools (4)
| Tool | What It Does |
|------|-------------|
| `generate_product_photo` | Product photos via fal.ai with reference images |
| `generate_asset` | Backgrounds, UI elements, textures, props |
| `remove_background` | AI background removal |
| `estimate_cost` | Per-concept cost breakdown before building |

### Pipeline Tools (2)
| Tool | What It Does |
|------|-------------|
| `batch_pipeline` | Chain tools with variable binding (6 round-trips to 1) |
| `batch_operations` | Compact DSL for fine-grained multi-node creation |

### Checkpoint Tools (4)
| Tool | What It Does |
|------|-------------|
| `save_checkpoint` | Serialize frame state for rollback |
| `restore_checkpoint` | Rebuild frame from saved state |
| `list_checkpoints` | List available rollback points |

### Template Tools (3)
| Tool | What It Does |
|------|-------------|
| `save_template` | Save completed ads as reusable templates |
| `browse_templates` | Browse template library with thumbnails |
| `apply_template` | Apply a template as starting point for new concept |

---

## How Opus 4.6 Is Used

This project pushes Opus 4.6 far beyond basic chat integration:

1. **Creative reasoning** — The agent develops ad *concepts* (angles, format categories, bold creative moves) before touching any tool. It reasons about what will stop someone mid-scroll.

2. **Design system internalization** — 2,200 lines of design rules in the system prompt. The agent applies 8px grid, typography hierarchy, safe zones, and composition principles without being told.

3. **Multi-tool orchestration** — The agent chains 10-20 tool calls per ad, making design decisions at each step based on visual feedback (screenshots). It's not following a script — it's designing.

4. **Self-evaluation via vision** — After building, the agent takes a screenshot and evaluates its own work. It sees spacing issues, legibility problems, and composition imbalances that would require a human designer's eye.

5. **Two-pass critic subagents** — Opus invokes Sonnet-based critic agents. Pass 1: blind visual review (no concept context). Pass 2: concept-aware creative review. Up to 3 iteration rounds.

6. **Learning and adaptation** — The agent logs design learnings, builds templates from successful ads, and its escape-hatch tool usage is tracked to automatically identify new tools that should be created.

7. **Batch pipeline planning** — The agent plans entire ad compositions as a single `batch_pipeline` call with variable binding between steps, reducing API latency from ~15 seconds to ~3 seconds.

---

## Setup & Usage

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Figma Desktop](https://www.figma.com/downloads/) app
- [Claude Max plan](https://claude.ai/) or Anthropic API key
- (Optional) [fal.ai](https://fal.ai/) API key for asset generation

### 1. Clone and install

```bash
git clone https://github.com/stnkvcs/figma-ad-agent.git
cd figma-ad-agent

# Install backend dependencies
cd backend && npm install && cd ..

# Install plugin dependencies
cd plugin && npm install && cd ..

# Install shared types
cd shared && npm install && cd ..
```

### 2. Configure environment

```bash
cd backend
cp .env.example .env
# Edit .env with your API keys and paths
```

### 3. Build the plugin

```bash
cd plugin && npm run build
```

### 4. Load plugin in Figma

1. Open Figma Desktop
2. Go to **Plugins > Development > Import plugin from manifest**
3. Select `plugin/manifest.json`

### 5. Start the backend server

```bash
cd backend

# If using Claude Max plan auth (recommended):
env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_CODE_SESSION_ID npx tsx src/server.ts

# Or with API key in .env:
npx tsx src/server.ts
```

### 6. Use the plugin

1. In Figma, run the plugin: **Plugins > Development > Ad Design Agent**
2. Select a brand/product from the dropdown
3. Start chatting: *"Build a story ad for Sintra Buddy. Angle: parents have no time for themselves. Borrowed interface format."*
4. Watch the agent build the ad in real-time on your canvas

### Brand Data Structure

The agent reads brand data from the filesystem. Create your brand folder like this:

```
brands/
  your-brand/
    brand/
      overview.md          # Brand voice, colors, fonts, positioning
    products/
      your-product/
        spec.md            # Product details, features, images
        assets/            # Product images, logos
    ads/
      concepts-log.md      # History of ads created (auto-updated)
      angles.md            # Angle tracking (auto-updated)
```

---

## Project Structure

```
figma-ad-agent/
  backend/               # Node.js server (Agent SDK)
    src/
      agent.ts           # Main agent config (32 tools, 2 critics)
      server.ts          # Express + WebSocket server
      bridge.ts          # Plugin communication layer
      tools/             # All 32 tool implementations
      hooks/             # Quality gate hooks (pre/post tool use)
      prompts/           # System prompt + critic prompts
      telemetry/         # Tool evolution tracking
    .env.example
  plugin/                # Figma plugin (TypeScript sandbox)
    src/
      code.ts            # Figma API executor
      ui.html            # Plugin UI panel
      ui.ts              # UI logic
    manifest.json
  shared/                # Shared types
    protocol.ts          # WebSocket protocol (typed, bidirectional)
    types.ts             # Common type definitions
  spec.md                # Full architecture spec (975 lines)
  session-summaries/     # Development journey (Phases 1-4)
```

---

## Development Journey

This project was built iteratively across 6 phases, each verified with end-to-end testing in live Figma:

| Phase | What | Tools |
|-------|------|-------|
| **Phase 1: Foundation** | Plugin scaffold, WebSocket protocol, agent setup | 2 tools |
| **Phase 2: Core Tools** | All design tools, image pipeline, font loading | 15 tools |
| **Phase 3a: Intelligence** | Brand data, ad library, quality hooks | 19 tools |
| **Phase 3b: Assets** | fal.ai integration, session persistence, cost tracking | 23 tools |
| **Phase 4: Review** | Batch updates, checkpoints, two-pass critic, debug UI | 27 tools |
| **Phase 5a: Pipeline** | Batch pipeline, DSL, templates, tool evolution | 32 tools |

Each phase's session summary is in `session-summaries/`. They document what was built, what worked, what surprised us, and what we learned.

---

## Key Design Decisions

**Why a Figma plugin, not a standalone app?**
Designers live in Figma. Bringing the agent to them (instead of asking them to use a terminal) removes all friction. The agent builds on the same canvas they'll iterate on.

**Why 32 custom tools instead of generic Figma API calls?**
The previous version used 35+ generic MCP tools (create_frame, set_fill, move_node). The agent made 30-50 calls per ad, fighting abstractions. Domain-specific tools like `place_product` encode 5-8 Figma API calls internally, including all the patterns we learned (always trim transparent images, always use auto-layout, start products at 60-80% frame width).

**Why two-pass critic?**
Pass 1 (fresh eyes) catches what the designer can't see because they're too close — spacing issues, legibility problems, safe zone violations. Pass 2 (contextual) evaluates whether the execution serves the concept. Both are needed.

**Why checkpoint/rollback?**
Figma has no transactions. A high-level tool encodes 5-15 API calls. If it fails at step 8, you need to undo steps 1-7. Checkpoints serialize the entire frame tree before risky operations and can rebuild from scratch if needed.

---

## License

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0).

You are free to use, modify, and distribute this software, provided that:
- Any modified versions must also be released under AGPL-3.0
- If you run a modified version as a network service, you must make the source code available to users of that service

---

## Built With

- [Claude Agent SDK](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/sdk) — Claude Code as a library
- [Claude Opus 4.6](https://www.anthropic.com/) — Main agent model
- [Figma Plugin API](https://www.figma.com/plugin-docs/) — Native Figma integration
- [fal.ai](https://fal.ai/) — Image generation (Nano Banana Pro)
- TypeScript, WebSocket, Express, SQLite
