/**
 * Agent SDK setup
 *
 * Configures the Claude agent with custom tools and system prompt.
 * Handles streaming output to the plugin UI via bridge.
 *
 * SDK API (v0.2.41):
 * - query({ prompt, options }) → AsyncGenerator<SDKMessage>
 * - tool(name, description, zodRawShape, handler) → SdkMcpToolDefinition
 * - createSdkMcpServer({ name, version, tools }) → McpSdkServerConfigWithInstance
 * - Options.mcpServers: Record<string, McpServerConfig> (keyed by name)
 * - Options.systemPrompt: string | { type: 'preset', preset: 'claude_code', append?: string }
 * - SDKMessage types: 'assistant' (BetaMessage wrapper), 'result', 'system', etc.
 */

import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import type { Bridge } from './bridge.js';
import { systemPrompt } from './prompts/system.js';
import { freshEyesCriticPrompt, contextualCriticPrompt } from './prompts/critic-prompts.js';
import {
  buildAdSkeleton,
  buildAdSkeletonSchema,
  addText,
  addTextSchema,
  getFrameState,
  getFrameStateSchema,
  setBackground,
  setBackgroundSchema,
  addEffect,
  addEffectSchema,
  applyTypography,
  applyTypographySchema,
  getCanvasScreenshot,
  getCanvasScreenshotSchema,
  placeProduct,
  placeProductSchema,
  rawFigmaOperation,
  rawFigmaOperationSchema,
  updateNode,
  updateNodeSchema,
  deleteNode,
  deleteNodeSchema,
  createShape,
  createShapeSchema,
  duplicateFrame,
  duplicateFrameSchema,
  exportAd,
  exportAdSchema,
  readBrandData,
  readBrandDataSchema,
  browseAdLibrary,
  browseAdLibrarySchema,
  completeConcept,
  completeConceptSchema,
  logLearning,
  logLearningSchema,
  reorderChildren,
  reorderChildrenSchema,
  generateProductPhoto,
  generateProductPhotoSchema,
  generateAsset,
  generateAssetSchema,
  removeBackground,
  removeBackgroundSchema,
  estimateCost,
  estimateCostSchema,
  batchUpdate,
  batchUpdateSchema,
  saveCheckpoint,
  saveCheckpointSchema,
  restoreCheckpoint,
  restoreCheckpointSchema,
  listCheckpoints,
  listCheckpointsSchema,
  batchPipeline,
  batchPipelineSchema,
  batchOperations,
  batchOperationsSchema,
  saveTemplate,
  saveTemplateSchema,
  browseTemplates,
  browseTemplatesSchema,
  applyTemplate,
  applyTemplateSchema,
} from './tools/index.js';
import { buildHooks } from './hooks/index.js';
import { getSessionState, addSessionCost } from './session-state.js';

// Tool handler result type (SDK MCP CallToolResult shape)
type ToolResult = {
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>;
  isError?: boolean;
};

export interface AgentConfig {
  model: string;
  bridge: Bridge;
}

// Session state for conversation history
let currentSessionId: string | null = null;

/**
 * Reset the session state (e.g., when switching brands or starting a new concept)
 */
export function resetSession() {
  currentSessionId = null;
  console.log('[Agent] Session reset');
}

/**
 * Set up agent with custom tools and register the user message handler.
 * Uses session persistence for conversation history across multiple messages.
 */
export async function setupAgent(config: AgentConfig): Promise<void> {
  const { model, bridge } = config;

  // Create tool definitions using SDK's positional API:
  // tool(name, description, zodRawShape, handler)
  // Schemas are z.object() — we pass .shape to get raw ZodRawShape
  const buildAdSkeletonTool = tool(
    'build_ad_skeleton',
    `Create the root frame for a new ad. ALWAYS start here — this sets up dimensions, auto-layout, padding, and safe zones correctly. Formats: story (1080x1920, 9:16), feed (1080x1080, 1:1), or custom. Returns the frame ID you'll use for all subsequent tools.

Examples:
- Story ad with dark bg: { format: "story", backgroundColor: "#0a0a0a", name: "Sintra — Time Theft — C1" }
- Feed ad, custom padding: { format: "feed", backgroundColor: "#1a1a2e", padding: 64 }
- Custom dimensions: { format: "custom", width: 1200, height: 628, name: "Facebook Ad" }`,
    buildAdSkeletonSchema.shape,
    async (input, _extra): Promise<ToolResult> => {
      const result = await buildAdSkeleton(input as any, bridge);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  const addTextTool = tool(
    'add_text',
    `Add a single text node. Use for simple one-off text additions like labels or fine print. For headlines + body copy compositions, prefer apply_typography which handles sizing, spacing, and split-and-stack automatically.

Use insertIndex to control z-order (layer order). 0 = behind all siblings, higher = in front. Without it, text is added on top of all existing children. Use fontStyle for non-standard weight names (e.g., "Ultralight", "Italic").

Examples:
- Fine print: { parentId: "1:23", text: "*Results may vary", fontSize: 24, fontColor: "#666666" }
- Brand label: { parentId: "1:23", text: "SINTRA", fontSize: 32, fontWeight: 500, fontColor: "#FFFFFF" }
- Non-standard font style: { parentId: "1:23", text: "Elegant", fontFamily: "PP Editorial Old", fontStyle: "Ultralight" }
- Text behind product (z-order): { parentId: "1:23", text: "700", fontSize: 400, fontColor: "#FFFFFF", insertIndex: 0 }`,
    addTextSchema.shape,
    async (input, _extra): Promise<ToolResult> => {
      const result = await addText(input as any, bridge);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  const getFrameStateTool = tool(
    'get_frame_state',
    `Inspect the structure of a frame and its children. Use mode='summary' for a quick text overview (saves tokens), mode='full' for complete JSON with all properties. Use this to understand what's on the canvas before making changes.

Examples:
- Quick check: { frameId: "1:23", mode: "summary" }
- Full inspection: { frameId: "1:23", mode: "full", depth: 5 }`,
    getFrameStateSchema.shape,
    async (input, _extra): Promise<ToolResult> => {
      const result = await getFrameState(input as any, bridge);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  const setBackgroundTool = tool(
    'set_background',
    `Set the background fill of a frame. Use for solid colors, linear gradients (with stops and rotation), or full-bleed background images from a file path. Applied as the frame's fill — replaces any existing background.

Examples:
- Solid dark: { frameId: "1:23", type: "solid", color: "#0a0a0a" }
- Top-to-bottom gradient: { frameId: "1:23", type: "gradient", gradient: { stops: [{ position: 0, color: "#0a0a17" }, { position: 1, color: "#1a1a2e" }], rotation: 180 } }
- Diagonal gradient: { frameId: "1:23", type: "gradient", gradient: { stops: [{ position: 0, color: "#FF6B6B" }, { position: 0.5, color: "#C850C0" }, { position: 1, color: "#4158D0" }], rotation: 135 } }
- Image background: { frameId: "1:23", type: "image", imagePath: "/abs/path/to/bg.jpg", scaleMode: "FILL" }`,
    setBackgroundSchema.shape,
    async (input, _extra): Promise<ToolResult> => {
      const result = await setBackground(input as any, bridge);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  const addEffectTool = tool(
    'add_effect',
    `Add a visual effect to any node. Use drop_shadow for depth between overlapping elements, layer_blur for frosted glass effects, background_blur for iOS-style translucency. Appends to existing effects (doesn't replace them).

Examples:
- Subtle shadow (default): { nodeId: "1:23", type: "drop_shadow" }
- Strong shadow: { nodeId: "1:23", type: "drop_shadow", color: "#00000040", offset: { x: 0, y: 8 }, radius: 24, spread: 4 }
- Frosted glass: { nodeId: "1:23", type: "background_blur", radius: 16 }`,
    addEffectSchema.shape,
    async (input, _extra): Promise<ToolResult> => {
      const result = await addEffect(input as any, bridge);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  const applyTypographyTool = tool(
    'apply_typography',
    `Add a multi-element text composition. Use for headline + subhead + body layouts. Each element has a semantic role with smart defaults (headline=120px, subhead=48px, body=40px). Automatically handles tight line-height on multi-line headlines via split-and-stack. Prefer this over add_text for any layout with 2+ text elements. Use clearExisting=true to wipe all children before rebuilding.

Examples:
- Headline + body: { frameId: "1:23", elements: [{ role: "headline", text: "Finally." }, { role: "body", text: "The brush that changes everything" }] }
- Multi-line headline (split-and-stack): { frameId: "1:23", elements: [{ role: "headline", text: "Your morning\\nroutine is broken" }] }
- Full composition: { frameId: "1:23", elements: [{ role: "headline", text: "2 minutes.", fontSize: 200, fontColor: "#FFFFFF" }, { role: "subhead", text: "That's all it takes to feel human again", fontColor: "#CCCCCC" }, { role: "fine_print", text: "*Based on clinical studies", fontColor: "#666666" }], spacing: 40 }
- Custom font with style override: { frameId: "1:23", elements: [{ role: "headline", text: "Bold move.", fontFamily: "PP Editorial Old", fontStyle: "Ultralight" }] }
- Rebuild text from scratch: { frameId: "1:23", clearExisting: true, elements: [{ role: "headline", text: "New headline" }] }`,
    applyTypographySchema.shape,
    async (input, _extra): Promise<ToolResult> => {
      const result = await applyTypography(input as any, bridge);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  const getCanvasScreenshotTool = tool(
    'get_canvas_screenshot',
    `Take a visual screenshot for verification. ALWAYS use after completing a draft or making significant changes. You will SEE the screenshot and can evaluate spacing, readability, composition, and overall quality. Use quality='draft' during building (fast), quality='final' for the last check before export.

Examples:
- Quick check during build: { nodeId: "1:23", quality: "draft" }
- Final quality gate: { nodeId: "1:23", quality: "final" }`,
    getCanvasScreenshotSchema.shape,
    async (input, _extra): Promise<ToolResult> => {
      // getCanvasScreenshot already returns the correct ToolResult format with image content
      const result = await getCanvasScreenshot(input as any, bridge);
      return result;
    }
  );

  const placeProductTool = tool(
    'place_product',
    `Place a product image from a file path. Automatically trims transparent pixels, scales relative to frame width (default 70%), and positions using presets (center-bottom, left, right, off-frame, etc.). Products are absolutely positioned inside auto-layout frames so they don't affect text flow.

Examples:
- Default placement: { frameId: "1:23", imagePath: "/abs/path/to/product.png" }
- Large, centered: { frameId: "1:23", imagePath: "/abs/path/to/product.png", position: "center", scale: 0.85 }
- Off-frame for energy: { frameId: "1:23", imagePath: "/abs/path/to/product.png", position: "off-frame-right", scale: 0.9 }
- Custom position: { frameId: "1:23", imagePath: "/abs/path/to/product.png", position: "custom", customX: 200, customY: 800, scale: 0.6 }
- No trim: { frameId: "1:23", imagePath: "/abs/path/to/bg-element.png", trimTransparency: false }`,
    placeProductSchema.shape,
    async (input, _extra): Promise<ToolResult> => {
      const result = await placeProduct(input as any, bridge);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  const rawFigmaOperationTool = tool(
    'raw_figma_operation',
    `Direct escape hatch to the Figma Plugin API. Use ONLY when no other tool covers your need. Prefer update_node for property changes, create_shape for shapes, delete_node for removal. Usage is logged for tool evolution tracking. Include a reason to help identify missing tool patterns.

Examples:
- Reparent a node: { method: "appendChild", args: ["parent-id", "child-id"], reason: "Moving text into a card frame" }
- Get node info: { method: "getNodeById", args: ["1:23"], reason: "Checking node properties not in get_frame_state" }`,
    rawFigmaOperationSchema.shape,
    async (input, _extra): Promise<ToolResult> => {
      const result = await rawFigmaOperation(input as any, bridge);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  const updateNodeTool = tool(
    'update_node',
    `Modify properties of an existing node. Primary iteration tool for position, size, color, opacity, text, auto-layout alignment, and layout sizing. Use this whenever you need to adjust something already created.

IMPORTANT for auto-layout: To align children to the left/right/center, set counterAxisAlignItems on the PARENT frame — NOT x/y on children (x/y are ignored inside auto-layout). To position a child absolutely inside auto-layout, set layoutPositioning: "ABSOLUTE" on the CHILD.

Examples:
- Left-align children: { nodeId: "parent-frame", properties: { counterAxisAlignItems: "MIN" } }
- Center children vertically: { nodeId: "parent-frame", properties: { primaryAxisAlignItems: "CENTER" } }
- Spread children: { nodeId: "parent-frame", properties: { primaryAxisAlignItems: "SPACE_BETWEEN" } }
- Make child absolute: { nodeId: "child-node", properties: { layoutPositioning: "ABSOLUTE", x: 100, y: 200 } }
- Child fills parent width: { nodeId: "child-node", properties: { layoutSizingHorizontal: "FILL" } }
- Shrink-wrap container: { nodeId: "frame", properties: { layoutSizingHorizontal: "HUG", layoutSizingVertical: "HUG" } }
- Change text alignment: { nodeId: "1:23", properties: { textAlignHorizontal: "LEFT" } }
- Change text color: { nodeId: "1:23", properties: { fontColor: "#FF6B6B" } }
- Move and resize: { nodeId: "1:23", properties: { x: 100, y: 200, width: 500, height: 300 } }
- Change spacing: { nodeId: "1:23", properties: { itemSpacing: 24, paddingTop: 64 } }`,
    updateNodeSchema.shape,
    async (input, _extra): Promise<ToolResult> => {
      const result = await updateNode(input as any, bridge);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  const deleteNodeTool = tool(
    'delete_node',
    `Remove a node from the canvas. Use when an element needs to be completely removed — wrong text, misplaced shape, or starting over on a section. Cannot be undone.

Examples:
- Remove a node: { nodeId: "1:23" }`,
    deleteNodeSchema.shape,
    async (input, _extra): Promise<ToolResult> => {
      const result = await deleteNode(input as any, bridge);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  const reorderChildrenTool = tool(
    'reorder_children',
    `Reorder children of a frame to change z-order (layer stacking). Provide child IDs in desired visual order: first = bottom/behind, last = top/front. Use this instead of deleting and recreating nodes just to change their stacking order.

Examples:
- Put product behind text: { parentId: "1:23", childIds: ["product-id", "text-id"] }
- Reorder 3 layers: { parentId: "1:23", childIds: ["bg-shape", "product", "headline"] }`,
    reorderChildrenSchema.shape,
    async (input, _extra): Promise<ToolResult> => {
      const result = await reorderChildren(input as any, bridge);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  const createShapeTool = tool(
    'create_shape',
    `Create a rectangle or ellipse. Use for decorative elements: color blocks, dividers, overlay rectangles for text readability, gradient overlays, circles, or any non-text visual element. For product images use place_product instead.

Use insertIndex to control z-order (layer order). 0 = behind all siblings, higher = in front. Without it, shapes are added on top of all existing children.

Examples:
- Glow BEHIND text (insert at bottom): { parentId: "1:23", shape: "ellipse", width: 600, height: 600, fillColor: "#FFFFFF", opacity: 0.15, absolutePosition: true, x: 240, y: 400, insertIndex: 0 }
- Overlay ON TOP: { parentId: "1:23", shape: "rectangle", width: 1080, height: 400, fillColor: "#000000", opacity: 0.5, absolutePosition: true, x: 0, y: 1520 }
- Rounded card: { parentId: "1:23", shape: "rectangle", width: 920, height: 300, fillColor: "#1a1a2e", cornerRadius: 24 }`,
    createShapeSchema.shape,
    async (input, _extra): Promise<ToolResult> => {
      const result = await createShape(input as any, bridge);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  const duplicateFrameTool = tool(
    'duplicate_frame',
    `Duplicate an existing frame to create a variation. Use when building multiple concepts from the same base layout — duplicate first, then modify the copy. The duplicate is placed to the right of the original.

Examples:
- Simple duplicate: { frameId: "1:23" }
- Named variation: { frameId: "1:23", newName: "Sintra — Time Theft — C2 (Variation)" }
- Custom spacing: { frameId: "1:23", newName: "Dark Version", offsetX: 200 }`,
    duplicateFrameSchema.shape,
    async (input, _extra): Promise<ToolResult> => {
      const result = await duplicateFrame(input as any, bridge);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  const exportAdTool = tool(
    'export_ad',
    `Export a completed ad frame as a high-res PNG file to disk. Use at the end of the workflow when the ad is finalized and reviewed. Default scale is 2x for production quality. Returns the file path.

Examples:
- Standard export: { frameId: "1:23", outputPath: "/Users/me/Desktop/sintra-ad-01.png" }
- 3x for retina: { frameId: "1:23", outputPath: "/Users/me/exports/ad.png", scale: 3 }`,
    exportAdSchema.shape,
    async (input, _extra): Promise<ToolResult> => {
      const result = await exportAd(input as any, bridge);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  // --- Phase 3 Intelligence Tools (no Bridge needed — filesystem/SQLite) ---

  const readBrandDataTool = tool(
    'read_brand_data',
    `Read brand files: overview, product specs, concepts-log, learnings, or list available files. Use at the start of every session to understand the brand before designing. Pass brand="_global" for cross-brand learnings.

Examples:
- List brand files: { brand: "sintra" }
- Read brand overview: { brand: "sintra", file: "brand/sintra-overview.md" }
- Read product spec: { brand: "sintra", file: "products/buddy/spec.md" }
- Check concepts history: { brand: "sintra", file: "ads/concepts-log.md" }
- Cross-brand learnings: { brand: "_global" }`,
    readBrandDataSchema.shape,
    async (input, _extra): Promise<ToolResult> => {
      return await readBrandData(input as any);
    }
  );

  const browseAdLibraryTool = tool(
    'browse_ad_library',
    `Browse the ad library for visual references. Returns thumbnail images with metadata. Use during ideation to find references matching your chosen format category. Map format categories to library categories: Editorial→"Strong Copy","Simple Layout"; Comparison→"Comparison","Before & After"; Social Proof→"Social Proof","Testimonial"; Borrowed Interface→"IG Story","iPhone Notes","Texting"; etc.

Examples:
- Browse comparisons: { categories: ["Comparison", "Before & After"], count: 5 }
- Story format refs: { categories: ["IG Story", "Bold"], aspectRatio: "9:16" }
- Multiple categories: { categories: ["Strong Copy", "Minimalistic", "Simple Layout"], count: 3 }`,
    browseAdLibrarySchema.shape,
    async (input, _extra): Promise<ToolResult> => {
      return await browseAdLibrary(input as any);
    }
  );

  const completeConceptTool = tool(
    'complete_concept',
    `Log a completed ad concept to the brand's concepts-log and angle index. Call this AFTER an ad is finalized — records L1 angle, L2 format category, L3 execution details for variety tracking. The concepts-log prevents repeating the same format/angle combinations.

Examples:
- Full logging: { brand: "sintra", angle: "Parents have no time for themselves", formatCategory: "Borrowed Interface", execution: "IG Story Q&A sticker with product reveal", productPosition: "center-bottom", productShot: "hand-held", background: "dark gradient", frameId: "1:23" }
- Minimal: { brand: "sintra", angle: "2 minutes is all it takes", formatCategory: "Editorial", execution: "Giant headline with product bleed", frameId: "1:23" }`,
    completeConceptSchema.shape,
    async (input, _extra): Promise<ToolResult> => {
      const result = await completeConcept(input as any);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  const logLearningTool = tool(
    'log_learning',
    `Record a design learning or principle discovered during the session. Brand-specific learnings go to the brand's learnings file, universal learnings go to the cross-brand file. Use when you discover something reusable about typography, spacing, composition, or concept execution.

Examples:
- Brand learning: { text: "Sintra's purple works best as accent, not background", brand: "sintra", category: "color" }
- Universal: { text: "Tight headlines (100-110% line-height) create more visual impact than default spacing", scope: "universal", category: "typography" }`,
    logLearningSchema.shape,
    async (input, _extra): Promise<ToolResult> => {
      const result = await logLearning(input as any);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  // --- Phase 3b: Asset Generation Tools (no Bridge needed — fal.ai + filesystem) ---

  const generateProductPhotoTool = tool(
    'generate_product_photo',
    `Generate a product photo using reference images via fal.ai. Takes 5-15 seconds. Returns a local file path — then use place_product to put it on the canvas. Supports up to 12 reference images for better fidelity. Use removeBg: true to get a cutout-ready image.

Examples:
- Simple: { prompt: "Product held in hand against warm sunlight", referenceImages: ["/path/to/product.png"] }
- Multiple refs + bg removal: { prompt: "Product on marble surface, editorial style", referenceImages: ["/path/front.png", "/path/side.png"], removeBg: true }
- Square format: { prompt: "Flat lay with product centered", referenceImages: ["/path/product.png"], aspectRatio: "1:1" }`,
    generateProductPhotoSchema.shape,
    async (input, _extra): Promise<ToolResult> => {
      const result = await generateProductPhoto(input as any);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  const generateAssetTool = tool(
    'generate_asset',
    `Generate a non-product asset: backgrounds, UI elements, props, textures, or people. Cheaper and faster than product photos (1K default). Returns a file path — use place_product or set_background to add it to the canvas. The type parameter affects prompt engineering for better results.

Examples:
- iOS keyboard: { prompt: "iOS keyboard, light mode, QWERTY layout", type: "ui_element", aspectRatio: "16:9" }
- Gradient background: { prompt: "soft gradient from deep navy to warm amber", type: "background" }
- Prop: { prompt: "scattered yellow supplement capsules on white surface", type: "prop", removeBg: true }
- Texture: { prompt: "organic paper texture, warm cream tone", type: "texture", aspectRatio: "1:1" }`,
    generateAssetSchema.shape,
    async (input, _extra): Promise<ToolResult> => {
      const result = await generateAsset(input as any);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  const removeBackgroundTool = tool(
    'remove_background',
    `Remove the background from an existing image using AI. Saves the result as a new file with _nobg suffix in the same directory. Use when you have an existing image that needs its background removed.

Examples:
- Remove bg: { imagePath: "/path/to/image.png" }`,
    removeBackgroundSchema.shape,
    async (input, _extra): Promise<ToolResult> => {
      const result = await removeBackground(input as any);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  const estimateCostTool = tool(
    'estimate_cost',
    `Estimate the fal.ai generation cost before building a concept. Call during ideation to present a cost breakdown to the user. Wait for confirmation before proceeding with expensive operations.

Examples:
- Typical concept: { numProductPhotos: 1, numAssets: 2 }
- Complex concept: { numProductPhotos: 2, numAssets: 3, numBgRemovals: 2 }
- Minimal: { numProductPhotos: 1 }`,
    estimateCostSchema.shape,
    async (input, _extra): Promise<ToolResult> => {
      const result = await estimateCost(input as any);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  // --- Phase 4: Batch Operations + Checkpoints ---

  const batchUpdateTool = tool(
    'batch_update',
    `Update multiple nodes in a single call. Use instead of sequential update_node calls when you need to modify 2+ nodes. Accepts an array of {nodeId, properties} objects — same property format as update_node. All updates execute in one round-trip, dramatically faster than individual calls.

Examples:
- Center-align all text: { updates: [{ nodeId: "1:23", properties: { textAlignHorizontal: "CENTER" } }, { nodeId: "1:24", properties: { textAlignHorizontal: "CENTER" } }] }
- Recolor + reposition: { updates: [{ nodeId: "1:23", properties: { fontColor: "#FFFFFF" } }, { nodeId: "1:24", properties: { x: 100, y: 200 } }] }
- Bulk opacity: { updates: [{ nodeId: "1:23", properties: { opacity: 0.8 } }, { nodeId: "1:24", properties: { opacity: 0.6 } }, { nodeId: "1:25", properties: { opacity: 0.4 } }] }`,
    batchUpdateSchema.shape,
    async (input, _extra): Promise<ToolResult> => {
      const result = await batchUpdate(input as any, bridge);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  const saveCheckpointTool = tool(
    'save_checkpoint',
    `Save the current state of a frame for potential rollback. Use before risky iterations — if the changes make things worse, you can restore to this point. Checkpoints are stored in memory by label.

Examples:
- Before iteration: { frameId: "1:23", label: "pre-iteration" }
- After typography: { frameId: "1:23", label: "after-typography" }
- Before critic review: { frameId: "1:23", label: "first-draft" }`,
    saveCheckpointSchema.shape,
    async (input, _extra): Promise<ToolResult> => {
      const result = await saveCheckpoint(input as any, bridge);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  const restoreCheckpointTool = tool(
    'restore_checkpoint',
    `Restore a frame to a previously saved checkpoint. Completely replaces the frame's children with the saved state. Use when iteration made things worse and you want to go back. The label must match a previously saved checkpoint.

Examples:
- Rollback: { label: "pre-iteration" }
- Go back to first draft: { label: "first-draft" }`,
    restoreCheckpointSchema.shape,
    async (input, _extra): Promise<ToolResult> => {
      const result = await restoreCheckpoint(input as any, bridge);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  const listCheckpointsTool = tool(
    'list_checkpoints',
    `List all saved checkpoints and their labels. Use to see what rollback points are available.

Examples:
- List all: {}`,
    listCheckpointsSchema.shape,
    async (_input, _extra): Promise<ToolResult> => {
      const result = await listCheckpoints(_input as any);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  // --- Phase 5a: Batch Pipeline + Operations + Templates ---

  const batchPipelineTool = tool(
    'batch_pipeline',
    `Chain multiple design tools in a single call with variable binding. Each step can reference results from earlier steps via $stepId.field.path syntax. Auto-checkpoints after step 1 and rolls back on failure. Use this to build entire ad compositions in one go instead of calling tools sequentially.

Only deterministic design tools are allowed: build_ad_skeleton, apply_typography, set_background, place_product, add_effect, get_canvas_screenshot, update_node, batch_update, delete_node, create_shape, duplicate_frame, reorder_children. NOT allowed: generate_product_photo, generate_asset, remove_background, checkpoint tools.

Examples:
- Build skeleton + background + typography: { pipeline: [{ id: "skeleton", tool: "build_ad_skeleton", args: { format: "story", backgroundColor: "#0a0a0a" } }, { id: "bg", tool: "set_background", args: { frameId: "$skeleton.frameId", type: "gradient", gradient: { stops: [{ position: 0, color: "#0a0a17" }, { position: 1, color: "#1a1a2e" }] } } }, { id: "text", tool: "apply_typography", args: { frameId: "$skeleton.frameId", elements: [{ role: "headline", text: "Finally." }] } }] }`,
    batchPipelineSchema.shape,
    async (input, _extra): Promise<ToolResult> => {
      const result = await batchPipeline(input as any, bridge);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  const batchOperationsTool = tool(
    'batch_operations',
    `Execute a compact DSL script for multi-node creation in a single round trip. Ideal for borrowed interfaces, custom cards, or any composition requiring precise control over individual nodes. Each line creates or mutates a node. $varName references bind parent-child relationships.

Operations:
  var=CREATE_FRAME($parent, {width, height, fillColor, layoutMode, ...})
  var=CREATE_TEXT($parent, {text, fontSize, fontColor, fontFamily, fontWeight, ...})
  var=CREATE_RECT($parent, {width, height, fillColor, cornerRadius, ...})
  SET_IMAGE_FILL($node, {imagePath: "/abs/path.png", scaleMode: "FILL"})
  TRIM($node)
  UPDATE($node, {x, y, opacity, fillColor, ...})
  SET_GRADIENT($node, {gradientType: "LINEAR", gradientStops: [...], rotation: 180})
  ADD_EFFECT($node, {type: "DROP_SHADOW", color: "#0000001A", offset: {x: 0, y: 4}, radius: 8})
  DELETE($node)
  REPARENT($node, $newParent, index?)
  // Comments start with //

Examples:
- iOS notification card:
  { operations: "card=CREATE_FRAME(null, {width: 920, height: 200, fillColor: \\"#FFFFFF\\", cornerRadius: 24, layoutMode: \\"HORIZONTAL\\", paddingTop: 16, paddingRight: 16, paddingBottom: 16, paddingLeft: 16, itemSpacing: 12})\\nicon=CREATE_RECT($card, {width: 48, height: 48, fillColor: \\"#007AFF\\", cornerRadius: 12})\\ntextCol=CREATE_FRAME($card, {layoutMode: \\"VERTICAL\\", itemSpacing: 4})\\ntitle=CREATE_TEXT($textCol, {text: \\"SINTRA\\", fontSize: 24, fontWeight: 600, fontColor: \\"#000000\\"})\\nbody=CREATE_TEXT($textCol, {text: \\"Your morning routine is ready\\", fontSize: 20, fontColor: \\"#666666\\"})" }`,
    batchOperationsSchema.shape,
    async (input, _extra): Promise<ToolResult> => {
      const result = await batchOperations(input as any, bridge);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  const saveTemplateTool = tool(
    'save_template',
    `Save a completed ad frame as a reusable template. Stores the full node tree + thumbnail. Use after completing a concept to build a template library. Browse saved templates with browse_templates and apply them as starting points with apply_template.

Examples:
- Save with metadata: { frameId: "1:23", name: "Dark Story — Borrowed Interface", formatCategory: "Borrowed Interface", brand: "sintra", tags: ["dark", "story", "IG"], description: "IG story chrome overlay with product reveal" }
- Simple save: { frameId: "1:23", name: "Feed — Editorial Bold" }`,
    saveTemplateSchema.shape,
    async (input, _extra): Promise<ToolResult> => {
      const result = await saveTemplate(input as any, bridge);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  const browseTemplatesTool = tool(
    'browse_templates',
    `Browse saved templates with optional filtering. Returns thumbnail images for visual browsing. Use during ideation to find a template that matches the target format, or when a user asks to reuse a past layout.

Examples:
- Browse all: {}
- Filter by format: { formatCategory: "Borrowed Interface" }
- Search by name/tags: { query: "dark story" }
- Filter by brand: { brand: "sintra", limit: 5 }`,
    browseTemplatesSchema.shape,
    async (input, _extra): Promise<ToolResult> => {
      return await browseTemplates(input as any);
    }
  );

  const applyTemplateTool = tool(
    'apply_template',
    `Apply a saved template as a starting point for a new concept. Creates a new frame with the template's full node tree. Then modify the applied frame to fit the new concept — change text, swap product images, adjust colors.

Examples:
- Apply at origin: { templateId: "abc-123" }
- Apply with offset and new name: { templateId: "abc-123", x: 1200, y: 0, name: "Sintra — New Concept — C3" }`,
    applyTemplateSchema.shape,
    async (input, _extra): Promise<ToolResult> => {
      const result = await applyTemplate(input as any, bridge);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  // Create MCP server with all 32 custom tools
  const mcpServer = createSdkMcpServer({
    name: 'figma-design',
    version: '0.6.0',
    tools: [
      buildAdSkeletonTool,
      addTextTool,
      getFrameStateTool,
      setBackgroundTool,
      addEffectTool,
      applyTypographyTool,
      getCanvasScreenshotTool,
      placeProductTool,
      rawFigmaOperationTool,
      updateNodeTool,
      deleteNodeTool,
      reorderChildrenTool,
      createShapeTool,
      duplicateFrameTool,
      exportAdTool,
      readBrandDataTool,
      browseAdLibraryTool,
      completeConceptTool,
      logLearningTool,
      generateProductPhotoTool,
      generateAssetTool,
      removeBackgroundTool,
      estimateCostTool,
      batchUpdateTool,
      saveCheckpointTool,
      restoreCheckpointTool,
      listCheckpointsTool,
      batchPipelineTool,
      batchOperationsTool,
      saveTemplateTool,
      browseTemplatesTool,
      applyTemplateTool,
    ],
  });

  console.log('[Agent] MCP server created with 32 tools');

  // Register user message handler
  // Uses session persistence for conversation history
  bridge.onUserMessage(async (action) => {
    if (action.type !== 'user_message') return;

    console.log('[Agent] Processing user message:', action.content);

    // Build prompt with selection context if available
    let prompt = action.content;
    if (action.selection && action.selection.length > 0) {
      const selectionDesc = action.selection.map(n => {
        let desc = `${n.type} "${n.name}" (id: ${n.id}, ${n.width}x${n.height})`;
        if (n.characters) desc += ` text: "${n.characters}"`;
        if (n.fontSize) desc += ` fontSize: ${n.fontSize}`;
        return desc;
      }).join('\n  ');
      prompt += `\n\n[Currently selected in Figma:\n  ${selectionDesc}\n]`;
    }

    try {
      bridge.sendUIUpdate({
        type: 'status',
        phase: 'thinking',
        message: 'Processing your request...',
      });

      // Build dynamic system prompt with brand context
      const session = getSessionState();
      let dynamicPrompt = systemPrompt;
      if (session) {
        dynamicPrompt += `\n\n## Current Session\nBrand: ${session.brand}\nProduct: ${session.product}\n\nYou are designing for **${session.brand} / ${session.product}**. Use read_brand_data with brand="${session.brand}" to load brand files. Always pass brand="${session.brand}" to complete_concept and log_learning.`;
      }

      // Add previous concept summaries (concept boundary pruning)
      if (session && session.conceptSummaries && session.conceptSummaries.length > 0) {
        dynamicPrompt += '\n\n## Previous Concepts This Session\n';
        for (const cs of session.conceptSummaries) {
          dynamicPrompt += `- **${cs.formatCategory}**: "${cs.angle}" — ${cs.execution}`;
          if (cs.frameId) dynamicPrompt += ` (frame: ${cs.frameId})`;
          dynamicPrompt += '\n';
        }
        dynamicPrompt += '\nAvoid repeating the same format category, visual treatment, or product position as previous concepts.';
      }

      // Add session cost
      if (session && session.totalCost > 0) {
        dynamicPrompt += `\n\nSession cost so far: $${session.totalCost.toFixed(2)}`;
      }

      // Build query options
      const options: any = {
        model,
        systemPrompt: dynamicPrompt,
        mcpServers: { 'figma-design': mcpServer },
        // Built-in tools: only Task (for subagent invocation) and Read (for critic file access)
        tools: ['Task', 'Read'],
        allowedTools: [
          // Built-in tools for subagent workflow
          'Task',
          'Read',
          // MCP design tools
          'mcp__figma-design__build_ad_skeleton',
          'mcp__figma-design__add_text',
          'mcp__figma-design__get_frame_state',
          'mcp__figma-design__set_background',
          'mcp__figma-design__add_effect',
          'mcp__figma-design__apply_typography',
          'mcp__figma-design__get_canvas_screenshot',
          'mcp__figma-design__place_product',
          'mcp__figma-design__raw_figma_operation',
          'mcp__figma-design__update_node',
          'mcp__figma-design__delete_node',
          'mcp__figma-design__reorder_children',
          'mcp__figma-design__create_shape',
          'mcp__figma-design__duplicate_frame',
          'mcp__figma-design__export_ad',
          'mcp__figma-design__read_brand_data',
          'mcp__figma-design__browse_ad_library',
          'mcp__figma-design__complete_concept',
          'mcp__figma-design__log_learning',
          'mcp__figma-design__generate_product_photo',
          'mcp__figma-design__generate_asset',
          'mcp__figma-design__remove_background',
          'mcp__figma-design__estimate_cost',
          // Phase 4 tools
          'mcp__figma-design__batch_update',
          'mcp__figma-design__save_checkpoint',
          'mcp__figma-design__restore_checkpoint',
          'mcp__figma-design__list_checkpoints',
          // Phase 5a tools
          'mcp__figma-design__batch_pipeline',
          'mcp__figma-design__batch_operations',
          'mcp__figma-design__save_template',
          'mcp__figma-design__browse_templates',
          'mcp__figma-design__apply_template',
        ],
        // Subagent definitions for two-pass critic review
        agents: {
          'fresh-eyes-critic': {
            description: 'Blind visual quality reviewer. Give it a screenshot file path. Returns PASS/FAIL with specific Tier 1 issues. Does NOT need concept context — judges purely on visual execution.',
            prompt: freshEyesCriticPrompt,
            tools: ['Read'],
            model: 'sonnet',
            maxTurns: 3,
          } as AgentDefinition,
          'contextual-critic': {
            description: 'Concept-aware creative director. Give it a screenshot file path AND the concept brief (angle, format category, execution plan, previous ads). Returns PASS/FAIL with concept alignment score and variety audit.',
            prompt: contextualCriticPrompt,
            tools: ['Read'],
            model: 'sonnet',
            maxTurns: 3,
          } as AgentDefinition,
        },
        hooks: buildHooks(),
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        maxTurns: 50,
        persistSession: true,
      };

      // Resume existing session if available
      if (currentSessionId) {
        options.resume = currentSessionId;
      }

      // Create query with selection-enriched prompt
      const q = query({ prompt, options });

      // Iterate the async generator of SDKMessages
      for await (const message of q) {
        const msg = message as any;

        // Capture session ID from first response
        if (msg.session_id && !currentSessionId) {
          currentSessionId = msg.session_id;
          console.log('[Agent] Session ID:', currentSessionId);
        }

        if (msg.type === 'assistant' && msg.message?.content) {
          // SDKAssistantMessage — msg.message is a BetaMessage
          // BetaMessage.content is an array of content blocks
          for (const block of msg.message.content) {
            if (block.type === 'text') {
              bridge.sendUIUpdate({
                type: 'agent_text',
                content: block.text,
              });
            } else if (block.type === 'tool_use') {
              bridge.sendUIUpdate({
                type: 'tool_start',
                tool: block.name,
                input: block.input,
              });
            } else if (block.type === 'tool_result') {
              bridge.sendUIUpdate({
                type: 'tool_result',
                tool: 'unknown',
                summary: typeof block.content === 'string'
                  ? block.content.substring(0, 200)
                  : JSON.stringify(block.content).substring(0, 200),
              });
            }
          }
        } else if (msg.type === 'result') {
          // SDKResultMessage — query completed
          if (msg.subtype === 'success') {
            console.log('[Agent] Query completed successfully');
            if (msg.total_cost_usd !== undefined) {
              bridge.sendUIUpdate({
                type: 'cost_update',
                spent: msg.total_cost_usd,
                budget: 10.0,
              });
              console.log(`[Agent] Cost: $${msg.total_cost_usd.toFixed(4)}`);
              // Accumulate cost in session state
              try { addSessionCost(msg.total_cost_usd); } catch { /* no session active */ }
            }
          } else if (msg.subtype === 'error') {
            console.error('[Agent] Query error:', msg.error);
            bridge.sendUIUpdate({
              type: 'error_friendly',
              message: msg.error || 'Agent query failed',
            });
          }
        }
      }

      bridge.sendUIUpdate({
        type: 'status',
        phase: 'idle',
        message: 'Ready',
      });

      console.log('[Agent] Request completed');
    } catch (error) {
      console.error('[Agent] Error processing message:', error);

      // If resume fails, reset and let user retry
      if (currentSessionId && error instanceof Error && error.message.includes('session')) {
        console.warn('[Agent] Session resume failed, resetting session');
        currentSessionId = null;
        bridge.sendUIUpdate({
          type: 'error_friendly',
          message: 'Session expired. Please try your request again.',
        });
      } else {
        bridge.sendUIUpdate({
          type: 'error_friendly',
          message: error instanceof Error ? error.message : 'An error occurred',
        });
      }

      bridge.sendUIUpdate({
        type: 'error_debug',
        message: 'Agent error',
        raw: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      });
    }
  });

  console.log('[Agent] Ready to process user messages');
}
