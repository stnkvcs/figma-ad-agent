# Phase 3b Stream A: Asset Generation Tools

**Date:** 2026-02-16
**Agent:** asset-tools (sonnet)
**Status:** COMPLETE ✅

---

## Summary

Implemented the complete fal.ai asset generation pipeline for the Figma Plugin Agent backend. All 4 tasks completed successfully, adding 3 new generation tools + 1 client module (~420 lines total).

---

## Files Created

### 1. `backend/src/fal-client.ts` (~127 lines)
Singleton fal.ai client + upload/download helpers.

**Features:**
- Configured fal SDK with FAL_KEY from environment
- `uploadFile(absolutePath)` with Map-based cache (tries SDK upload, falls back to raw HTTP)
- `downloadImage(url, outputPath)` for fetching generated results
- Lazy configuration with helpful error messages
- Exports configured `fal` instance for direct API calls

**Key details:**
- Upload cache prevents redundant transfers
- Dual-mode upload: SDK first, raw HTTP fallback
- Supports PNG, JPG, JPEG, WebP content types

### 2. `backend/src/tools/generate-product-photo.ts` (~120 lines)
Product photography generation via Nano Banana Pro Edit API.

**Schema:**
```typescript
{
  prompt: string,
  referenceImages: string[] (1-12),
  aspectRatio?: '9:16'|'1:1'|'16:9'|etc,
  resolution?: '1K'|'2K',
  removeBg?: boolean,
  name?: string
}
```

**Flow:**
1. Upload all reference images in parallel
2. Append REALISM_SUFFIX to prompt (enforces photorealism)
3. Call `fal-ai/nano-banana-pro/edit` API
4. Download result to `backend/data/assets/{sessionId}/`
5. Optional background removal via BRIA API
6. Return imagePath, dimensions, cost

**Cost:** $0.12 base + $0.03 for bg removal

### 3. `backend/src/tools/generate-asset.ts` (~120 lines)
Generic asset generation via Nano Banana Pro T2I API.

**Schema:**
```typescript
{
  prompt: string,
  type: 'background'|'ui_element'|'prop'|'texture'|'person',
  aspectRatio?: '9:16'|etc,
  resolution?: '1K'|'2K',
  removeBg?: boolean,
  seed?: number,
  name?: string
}
```

**Type-specific prompt engineering:**
- `ui_element`: "High-fidelity screenshot of {prompt}. Photorealistic UI rendering, pixel-perfect, native styling."
- `background`: "Abstract background: {prompt}. Seamless, high-resolution, suitable as ad background."
- `prop`: "Product photography prop: {prompt}. Studio lighting, clean composition."
- `texture`: "Seamless texture: {prompt}. Tileable, high-resolution."
- `person`: "{prompt}. Professional photography, natural lighting, authentic."

**Flow:** Same as product photo, but with text-to-image API instead of edit API.

**Cost:** $0.06 base + $0.03 for bg removal

### 4. `backend/src/tools/remove-background.ts` (~55 lines)
Standalone background removal tool.

**Schema:**
```typescript
{ imagePath: string }
```

**Flow:**
1. Upload image to fal storage
2. Call BRIA background removal API
3. Download result to same directory with `_nobg` suffix
4. Return new imagePath

**Cost:** $0.03

---

## Tool Design Patterns

All tools follow the reference pattern from `place-product.ts`:

### Exports
- `{name}Schema` (zod v4 schema)
- `{name}` (async handler function)

### Handler signature
```typescript
async function toolName(input: ToolInput): Promise<any>
```

### Error handling
```typescript
try {
  // Implementation
  return { imagePath, width, height, cost, message };
} catch (err: any) {
  return { error: true, message: `...` };
}
```

### Session-aware output
```typescript
const sessionState = getSessionState();
const sessionId = sessionState?.sessionId ?? `session_${Date.now()}`;
const outputDir = path.join(process.cwd(), 'data', 'assets', sessionId);
mkdirSync(outputDir, { recursive: true });
```

---

## TypeScript Compilation

✅ All files compile without errors (`npx tsc --noEmit`)

**Issue encountered:** Initial `import * as fal` created a namespace object instead of importing the singleton. Fixed by using named import: `import { fal } from '@fal-ai/client'`.

---

## Dependencies Installed

```bash
npm install @fal-ai/client
```

Package version: `@fal-ai/client` (latest compatible with Node.js)

---

## Next Steps

Ready for integration:
- **Task #11:** Register 4 new tools in agent.ts + update index.ts
- **Task #12:** Update system prompt with new tool docs

These tools will enable the agent to generate product photography, backgrounds, UI elements, props, textures, and people autonomously during ad creation.

---

## Session Notes

**Smooth execution.** All patterns from the terminal workflow (product-photography, asset-generation, image-manipulation skills) transferred cleanly to TypeScript + fal.ai SDK. No major blockers.

**SDK learning:** The fal.ai client uses a singleton pattern (`fal` export) with `.config()`, `.subscribe()`, and `.storage` methods. Documentation was accurate.

**Cost tracking:** All tools return `cost` in their response for budget tracking (Task #10 will aggregate these).

**Session state:** Current version of session-state.ts already includes `sessionId` field (Task #6 completed earlier), so no fallback logic was needed in practice.
