/**
 * Figma Plugin Main Thread (code.ts)
 *
 * Runs in Figma's main thread with access to figma.* API.
 * No network access — all communication via postMessage with UI.
 *
 * Responsibilities:
 * - Receive commands from UI (which receives them from backend via WebSocket)
 * - Execute Figma API operations
 * - Send results back to UI (which forwards to backend)
 * - Monitor selection changes and relay to UI
 */

import type { PluginCommand, PluginResponse, NodeInfo, SerializedNode, SerializedPaint, SerializedEffect } from '../../shared/protocol';

// Show UI panel
figma.showUI(__html__, {
  width: 400,
  height: 700,
  themeColors: true,
});

// Listen for messages from UI
figma.ui.onmessage = async (msg: PluginCommand) => {
  try {
    switch (msg.type) {
      case 'figma_call':
        await handleFigmaCall(msg);
        break;
      case 'export_node':
        await handleExportNode(msg);
        break;
      case 'get_state':
        await handleGetState(msg);
        break;
      case 'serialize_frame':
        await handleSerializeFrame(msg);
        break;
      case 'restore_checkpoint':
        await handleRestoreCheckpoint(msg);
        break;
      case 'get_selection':
        await handleGetSelection(msg);
        break;
      case 'image_data':
        await handleImageData(msg);
        break;
      case 'batch_update':
        await handleBatchUpdate(msg);
        break;
      case 'batch_operations':
        await handleBatchOperations(msg);
        break;
      default: {
        const unhandled = msg as PluginCommand;
        sendError(unhandled.id, `Unknown command type: ${(unhandled as any).type}`);
      }
    }
  } catch (error: any) {
    sendError(msg.id, error.message || String(error));
  }
};

// Monitor selection changes
figma.on('selectionchange', () => {
  const selection = figma.currentPage.selection;
  const nodes: NodeInfo[] = selection.map(node => ({
    id: node.id,
    type: node.type,
    name: node.name,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    fontSize: node.type === 'TEXT' ? node.fontSize as number : undefined,
    characters: node.type === 'TEXT' ? node.characters : undefined,
  }));

  figma.ui.postMessage({
    type: 'selection_changed',
    nodes,
  } as PluginResponse);
});

// ─── Command Handlers ───

async function handleFigmaCall(msg: Extract<PluginCommand, { type: 'figma_call' }>) {
  const { id, method, args } = msg;

  // Map of supported methods to handlers
  const handlers: Record<string, (...args: any[]) => any> = {
    createFrame: async (opts: any) => {
      const frame = figma.createFrame();
      // Append to parent if specified, with optional z-order control
      if (opts.parentId) {
        const parent = figma.getNodeById(opts.parentId);
        if (parent && 'appendChild' in parent) {
          const p = parent as FrameNode;
          if (opts.insertIndex !== undefined) {
            p.insertChild(opts.insertIndex, frame);
          } else {
            p.appendChild(frame);
          }
        }
      }
      await applyNodeProperties(frame, opts);
      return { id: frame.id };
    },
    createText: async (opts: any) => {
      const text = figma.createText();

      // Load font before setting any text properties
      // Accept fontFamily+fontStyle (from tools) or fontName object
      const requestedFamily = opts.fontFamily || (opts.fontName && opts.fontName.family) || 'Inter';
      const requestedStyle = opts.fontStyle || (opts.fontName && opts.fontName.style) || 'Regular';
      let fontFamily = requestedFamily;
      let fontStyle = requestedStyle;
      try {
        await figma.loadFontAsync({ family: fontFamily, style: fontStyle });
      } catch {
        // Smart fallback: search for closest available style in the same family
        let found = false;
        try {
          const available = await figma.listAvailableFontsAsync();
          const familyFonts = available.filter(f => f.fontName.family === requestedFamily);
          if (familyFonts.length > 0) {
            // Try exact case-insensitive match first
            const exactMatch = familyFonts.find(f => f.fontName.style.toLowerCase() === requestedStyle.toLowerCase());
            if (exactMatch) {
              fontStyle = exactMatch.fontName.style;
              await figma.loadFontAsync({ family: fontFamily, style: fontStyle });
              found = true;
            } else {
              // Fall back to Regular, then first available style in the same family
              const regular = familyFonts.find(f => f.fontName.style === 'Regular');
              const fallbackFont = regular || familyFonts[0];
              fontStyle = fallbackFont.fontName.style;
              await figma.loadFontAsync({ family: fontFamily, style: fontStyle });
              found = true;
            }
          }
        } catch {
          // listAvailableFontsAsync failed — continue to Inter fallback
        }
        if (!found) {
          console.warn(`Font not available: ${requestedFamily}/${requestedStyle}, falling back to Inter/Regular`);
          fontFamily = 'Inter';
          fontStyle = 'Regular';
          await figma.loadFontAsync({ family: fontFamily, style: fontStyle });
        }
      }
      text.fontName = { family: fontFamily, style: fontStyle };

      // Set text content
      if (opts.characters) text.characters = opts.characters;

      // Set font size
      if (opts.fontSize) text.fontSize = opts.fontSize;

      // Set text color via fills (fontColor from tool → fills array)
      if (opts.fontColor) {
        text.fills = [{ type: 'SOLID', color: opts.fontColor }];
      }

      // Set text auto-resize for proper sizing
      if (opts.textAutoResize) {
        text.textAutoResize = opts.textAutoResize;
      } else {
        text.textAutoResize = 'WIDTH_AND_HEIGHT'; // Default: single-line auto-size
      }

      // Append to parent frame if specified, with optional z-order control
      if (opts.parentId) {
        const parent = figma.getNodeById(opts.parentId);
        if (parent && 'appendChild' in parent) {
          const p = parent as FrameNode;
          if (opts.insertIndex !== undefined) {
            p.insertChild(opts.insertIndex, text);
          } else {
            p.appendChild(text);
          }
        }
      }

      // Apply remaining properties (position, etc.)
      await applyNodeProperties(text, opts);

      return { id: text.id, fontApplied: { family: fontFamily, style: fontStyle } };
    },
    createRectangle: async (opts: any) => {
      const rect = figma.createRectangle();
      // Append to parent if specified, with optional z-order control
      if (opts.parentId) {
        const parent = figma.getNodeById(opts.parentId);
        if (parent && 'appendChild' in parent) {
          const p = parent as FrameNode;
          if (opts.insertIndex !== undefined) {
            p.insertChild(opts.insertIndex, rect);
          } else {
            p.appendChild(rect);
          }
        }
      }
      await applyNodeProperties(rect, opts);
      return { id: rect.id };
    },
    createEllipse: async (opts: any) => {
      const ellipse = figma.createEllipse();
      // Append to parent if specified, with optional z-order control
      if (opts.parentId) {
        const parent = figma.getNodeById(opts.parentId);
        if (parent && 'appendChild' in parent) {
          const p = parent as FrameNode;
          if (opts.insertIndex !== undefined) {
            p.insertChild(opts.insertIndex, ellipse);
          } else {
            p.appendChild(ellipse);
          }
        }
      }
      await applyNodeProperties(ellipse, opts);
      return { id: ellipse.id };
    },
    getNodeById: async (nodeId: string) => {
      const node = figma.getNodeById(nodeId);
      if (!node) throw new Error(`Node not found: ${nodeId}`);
      return serializeNode(node as SceneNode, 2); // depth=2 for basic structure
    },
    updateNode: async (nodeId: string, props: any) => {
      const node = figma.getNodeById(nodeId);
      if (!node) throw new Error(`Node not found: ${nodeId}`);
      await applyNodeProperties(node as SceneNode, props);
      return { success: true };
    },
    deleteNode: async (nodeId: string) => {
      const node = figma.getNodeById(nodeId);
      if (!node) throw new Error(`Node not found: ${nodeId}`);
      node.remove();
      return { success: true };
    },
    appendChild: async (parentId: string, childId: string, index?: number) => {
      const parent = figma.getNodeById(parentId) as FrameNode | GroupNode;
      const child = figma.getNodeById(childId) as SceneNode;
      if (!parent || !child) throw new Error('Parent or child node not found');
      if (index !== undefined) {
        (parent as FrameNode).insertChild(index, child);
      } else {
        parent.appendChild(child);
      }
      return { success: true };
    },
    cloneNode: async (nodeId: string) => {
      const node = figma.getNodeById(nodeId);
      if (!node) throw new Error(`Node not found: ${nodeId}`);
      const clone = (node as SceneNode).clone();
      return { id: clone.id };
    },
  };

  const handler = handlers[method];
  if (!handler) {
    throw new Error(`Unknown method: ${method}`);
  }

  const result = await handler(...args);
  sendResult(id, result);
}

async function handleExportNode(msg: Extract<PluginCommand, { type: 'export_node' }>) {
  const { id, nodeId, format, scale } = msg;
  const node = figma.getNodeById(nodeId);
  if (!node) throw new Error(`Node not found: ${nodeId}`);

  const exportSettings: ExportSettings = {
    format: format as 'PNG' | 'SVG' | 'JPG',
    constraint: { type: 'SCALE', value: scale },
  };

  const bytes = await (node as ExportMixin).exportAsync(exportSettings);
  const base64 = figma.base64Encode(bytes);

  sendResult(id, { base64 });
}

async function handleGetState(msg: Extract<PluginCommand, { type: 'get_state' }>) {
  const selection = figma.currentPage.selection;
  const nodes: NodeInfo[] = selection.map(node => ({
    id: node.id,
    type: node.type,
    name: node.name,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    fontSize: node.type === 'TEXT' ? node.fontSize as number : undefined,
    characters: node.type === 'TEXT' ? node.characters : undefined,
  }));

  sendResult(msg.id, {
    pageId: figma.currentPage.id,
    pageName: figma.currentPage.name,
    selection: nodes,
  });
}

async function handleSerializeFrame(msg: Extract<PluginCommand, { type: 'serialize_frame' }>) {
  const node = figma.getNodeById(msg.frameId);
  if (!node) throw new Error(`Frame not found: ${msg.frameId}`);

  const serialized = serializeNode(node as SceneNode, 10); // full depth for checkpointing
  sendResult(msg.id, serialized);
}

async function handleRestoreCheckpoint(msg: Extract<PluginCommand, { type: 'restore_checkpoint' }>) {
  const { id, frameId, serialized } = msg;

  const targetFrame = figma.getNodeById(frameId) as FrameNode;
  if (!targetFrame) throw new Error(`Frame not found: ${frameId}`);

  // Step 1: Collect image hashes from the existing tree before clearing
  // (image data survives in Figma's image store by hash)
  const existingImageHashes = new Set<string>();
  collectImageHashes(targetFrame, existingImageHashes);

  // Step 2: Clear all children
  while (targetFrame.children.length > 0) {
    targetFrame.children[0].remove();
  }

  // Step 3: Restore frame properties from serialized root
  await restoreNodeProperties(targetFrame, serialized);

  // Step 4: Recursively rebuild children
  if (serialized.children) {
    for (const childData of serialized.children) {
      await rebuildNode(childData, targetFrame);
    }
  }

  sendResult(id, { success: true, frameId, childrenRestored: serialized.children?.length ?? 0 });
}

function collectImageHashes(node: SceneNode, hashes: Set<string>): void {
  if ('fills' in node) {
    const fills = (node as any).fills;
    if (fills !== figma.mixed && Array.isArray(fills)) {
      for (const fill of fills) {
        if (fill.type === 'IMAGE' && fill.imageHash) {
          hashes.add(fill.imageHash);
        }
      }
    }
  }
  if ('children' in node) {
    for (const child of (node as ChildrenMixin).children) {
      collectImageHashes(child as SceneNode, hashes);
    }
  }
}

async function rebuildNode(data: SerializedNode, parent: FrameNode | GroupNode): Promise<SceneNode> {
  let node: SceneNode;

  switch (data.type) {
    case 'FRAME': {
      const frame = figma.createFrame();
      parent.appendChild(frame);
      // Apply properties and then rebuild children
      await restoreNodeProperties(frame, data);
      if (data.children) {
        for (const childData of data.children) {
          await rebuildNode(childData, frame);
        }
      }
      node = frame;
      break;
    }
    case 'TEXT': {
      const text = figma.createText();
      // Load font before appending and setting properties
      const fontFamily = data.fontName?.family || 'Inter';
      const fontStyle = data.fontName?.style || 'Regular';
      try {
        await figma.loadFontAsync({ family: fontFamily, style: fontStyle });
      } catch {
        // Fallback to Inter/Regular
        try {
          await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
        } catch {
          // Last resort — continue without font loaded
        }
      }
      parent.appendChild(text);
      await restoreNodeProperties(text, data);
      node = text;
      break;
    }
    case 'RECTANGLE': {
      const rect = figma.createRectangle();
      parent.appendChild(rect);
      await restoreNodeProperties(rect, data);
      node = rect;
      break;
    }
    case 'ELLIPSE': {
      const ellipse = figma.createEllipse();
      parent.appendChild(ellipse);
      await restoreNodeProperties(ellipse, data);
      node = ellipse;
      break;
    }
    default: {
      // For unsupported types, create a rectangle placeholder
      const placeholder = figma.createRectangle();
      parent.appendChild(placeholder);
      placeholder.name = `[${data.type}] ${data.name}`;
      placeholder.resize(data.width || 100, data.height || 100);
      placeholder.x = data.x || 0;
      placeholder.y = data.y || 0;
      node = placeholder;
      break;
    }
  }

  return node;
}

async function restoreNodeProperties(node: SceneNode, data: SerializedNode): Promise<void> {
  // Name
  if (data.name) node.name = data.name;

  // Position and dimensions
  const ln = node as SceneNode & LayoutMixin;
  if (data.x !== undefined) ln.x = data.x;
  if (data.y !== undefined) ln.y = data.y;
  if (data.width !== undefined && data.height !== undefined) {
    ln.resize(data.width, data.height);
  }
  if (data.rotation !== undefined) ln.rotation = data.rotation;

  // Visibility and locked state
  if (data.visible === false) node.visible = false;
  if (data.locked === true) node.locked = true;

  // Opacity
  if (data.opacity !== undefined) {
    (node as BlendMixin).opacity = data.opacity;
  }

  // Fills — restore solid, gradient, and image fills
  if (data.fills && 'fills' in node) {
    const restoredFills: Paint[] = [];
    for (const fill of data.fills) {
      const paint = restorePaint(fill);
      if (paint) restoredFills.push(paint);
    }
    if (restoredFills.length > 0) {
      (node as GeometryMixin).fills = restoredFills;
    }
  }

  // Strokes
  if (data.strokes && 'strokes' in node) {
    const restoredStrokes: Paint[] = [];
    for (const stroke of data.strokes) {
      const paint = restorePaint(stroke);
      if (paint) restoredStrokes.push(paint);
    }
    if (restoredStrokes.length > 0) {
      (node as GeometryMixin).strokes = restoredStrokes;
    }
  }

  // Stroke weight
  if (data.strokeWeight !== undefined && 'strokeWeight' in node) {
    (node as GeometryMixin).strokeWeight = data.strokeWeight;
  }

  // Corner radius
  if (data.cornerRadius !== undefined && 'cornerRadius' in node) {
    (node as RectangleNode | FrameNode).cornerRadius = data.cornerRadius;
  }

  // Effects
  if (data.effects && 'effects' in node) {
    const restoredEffects: Effect[] = data.effects.map(e => restoreEffect(e));
    (node as BlendMixin).effects = restoredEffects;
  }

  // Layout positioning (must be set before auto-layout props to avoid conflicts)
  if (data.layoutPositioning !== undefined) {
    (node as any).layoutPositioning = data.layoutPositioning;
  }

  // Layout sizing
  if (data.layoutSizingHorizontal !== undefined) {
    (node as any).layoutSizingHorizontal = data.layoutSizingHorizontal;
  }
  if (data.layoutSizingVertical !== undefined) {
    (node as any).layoutSizingVertical = data.layoutSizingVertical;
  }

  // Auto-layout properties (FRAME only)
  if (node.type === 'FRAME') {
    const frame = node as FrameNode;

    // Set layoutMode first — this enables auto-layout
    if (data.layoutMode !== undefined) {
      frame.layoutMode = data.layoutMode as 'NONE' | 'HORIZONTAL' | 'VERTICAL';
    }

    if (data.layoutMode && data.layoutMode !== 'NONE') {
      if (data.itemSpacing !== undefined) frame.itemSpacing = data.itemSpacing;
      if (data.paddingTop !== undefined) frame.paddingTop = data.paddingTop;
      if (data.paddingRight !== undefined) frame.paddingRight = data.paddingRight;
      if (data.paddingBottom !== undefined) frame.paddingBottom = data.paddingBottom;
      if (data.paddingLeft !== undefined) frame.paddingLeft = data.paddingLeft;
      if (data.primaryAxisAlignItems !== undefined) {
        frame.primaryAxisAlignItems = data.primaryAxisAlignItems as 'MIN' | 'MAX' | 'CENTER' | 'SPACE_BETWEEN';
      }
      if (data.counterAxisAlignItems !== undefined) {
        frame.counterAxisAlignItems = data.counterAxisAlignItems as 'MIN' | 'MAX' | 'CENTER';
      }
      if (data.primaryAxisSizingMode !== undefined) {
        frame.primaryAxisSizingMode = data.primaryAxisSizingMode as 'FIXED' | 'AUTO';
      }
      if (data.counterAxisSizingMode !== undefined) {
        frame.counterAxisSizingMode = data.counterAxisSizingMode as 'FIXED' | 'AUTO';
      }
    }

    // Layout sizing for child frames inside auto-layout parents
    if (data.layoutSizingHorizontal !== undefined) {
      frame.layoutSizingHorizontal = data.layoutSizingHorizontal as 'FIXED' | 'HUG' | 'FILL';
    }
    if (data.layoutSizingVertical !== undefined) {
      frame.layoutSizingVertical = data.layoutSizingVertical as 'FIXED' | 'HUG' | 'FILL';
    }

    // Clips content
    if (data.clipsContent !== undefined) frame.clipsContent = data.clipsContent;

    // ALWAYS re-apply dimensions after layout mode changes — layoutMode triggers HUG which shrinks
    if (data.width !== undefined && data.height !== undefined) {
      frame.resize(data.width, data.height);
    }
  }

  // Text properties (TEXT only)
  if (node.type === 'TEXT') {
    const text = node as TextNode;

    // Font must be loaded before setting text properties
    if (data.fontName) {
      try {
        await figma.loadFontAsync(data.fontName);
        text.fontName = data.fontName;
      } catch {
        // Fallback — font already loaded in rebuildNode
      }
    }

    if (data.characters !== undefined) text.characters = data.characters;
    if (data.fontSize !== undefined) text.fontSize = data.fontSize as number;
    if (data.textAlignHorizontal !== undefined) {
      text.textAlignHorizontal = data.textAlignHorizontal as 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
    }
    if (data.textAlignVertical !== undefined) {
      text.textAlignVertical = data.textAlignVertical as 'TOP' | 'CENTER' | 'BOTTOM';
    }
    if (data.textAutoResize !== undefined) {
      text.textAutoResize = data.textAutoResize as 'NONE' | 'WIDTH_AND_HEIGHT' | 'HEIGHT' | 'TRUNCATE';
    }
    if (data.lineHeight !== undefined) {
      text.lineHeight = data.lineHeight as LineHeight;
    }
    if (data.letterSpacing !== undefined) {
      text.letterSpacing = data.letterSpacing as LetterSpacing;
    }
    if (data.textCase !== undefined) {
      text.textCase = data.textCase as TextCase;
    }
    if (data.textDecoration !== undefined) {
      text.textDecoration = data.textDecoration as TextDecoration;
    }
  }
}

function restorePaint(fill: SerializedPaint): Paint | null {
  if (fill.type === 'SOLID' && fill.color) {
    return {
      type: 'SOLID',
      color: fill.color,
      opacity: fill.opacity ?? 1,
      visible: fill.visible ?? true,
    } as SolidPaint;
  }

  if (fill.type.startsWith('GRADIENT') && fill.gradientStops) {
    return {
      type: fill.type as GradientPaint['type'],
      gradientStops: fill.gradientStops.map(s => ({
        position: s.position,
        color: s.color,
      })),
      gradientTransform: fill.gradientTransform as Transform || [[1, 0, 0], [0, 1, 0]],
      opacity: fill.opacity ?? 1,
      visible: fill.visible ?? true,
    } as GradientPaint;
  }

  if (fill.type === 'IMAGE' && fill.imageHash) {
    return {
      type: 'IMAGE',
      imageHash: fill.imageHash,
      scaleMode: (fill.scaleMode || 'FILL') as ImagePaint['scaleMode'],
      imageTransform: fill.imageTransform as Transform || [[1, 0, 0], [0, 1, 0]],
      opacity: fill.opacity ?? 1,
      visible: fill.visible ?? true,
    } as ImagePaint;
  }

  // Unsupported paint type — skip
  return null;
}

function restoreEffect(data: SerializedEffect): Effect {
  const base: any = {
    type: data.type,
    visible: data.visible ?? true,
  };

  if (data.radius !== undefined) base.radius = data.radius;
  if (data.color !== undefined) base.color = data.color;
  if (data.offset !== undefined) base.offset = data.offset;
  if (data.spread !== undefined) base.spread = data.spread;

  return base as Effect;
}

async function handleGetSelection(msg: Extract<PluginCommand, { type: 'get_selection' }>) {
  const selection = figma.currentPage.selection;
  const nodes: NodeInfo[] = selection.map(node => ({
    id: node.id,
    type: node.type,
    name: node.name,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    fontSize: node.type === 'TEXT' ? node.fontSize as number : undefined,
    characters: node.type === 'TEXT' ? node.characters : undefined,
  }));

  sendResult(msg.id, nodes);
}

async function handleImageData(msg: Extract<PluginCommand, { type: 'image_data' }>) {
  const { id, base64, targetNodeId, scaleMode } = msg;

  const node = figma.getNodeById(targetNodeId);
  if (!node) throw new Error(`Target node not found: ${targetNodeId}`);

  // Decode base64 to Uint8Array
  const bytes = figma.base64Decode(base64);

  // Create image in Figma
  const image = figma.createImage(bytes);

  // Apply image as fill
  const fillableNode = node as GeometryMixin;
  fillableNode.fills = [{
    type: 'IMAGE',
    scaleMode: scaleMode,
    imageHash: image.hash,
  }];

  sendResult(id, { success: true, imageHash: image.hash });
}

async function handleBatchUpdate(msg: Extract<PluginCommand, { type: 'batch_update' }>) {
  const { id, updates } = msg;
  const errors: Array<{ nodeId: string; error: string }> = [];

  for (const update of updates) {
    try {
      const node = figma.getNodeById(update.nodeId);
      if (!node) {
        errors.push({ nodeId: update.nodeId, error: `Node not found: ${update.nodeId}` });
        continue;
      }
      await applyNodeProperties(node as SceneNode, update.properties);
    } catch (error: any) {
      errors.push({ nodeId: update.nodeId, error: error.message || String(error) });
    }
  }

  sendResult(id, {
    success: errors.length === 0,
    updated: updates.length - errors.length,
    errors,
  });
}

// ─── Batch Operations Handler ───

async function handleBatchOperations(msg: Extract<PluginCommand, { type: 'batch_operations' }>) {
  const { id, operations } = msg;
  const variables = new Map<string, string>();
  const results: Array<{
    op: string;
    variable?: string;
    nodeId?: string;
    success: boolean;
    error?: string;
  }> = [];

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];

    try {
      switch (op.op) {
        case 'CREATE_FRAME': {
          const frame = figma.createFrame();
          const parentId = resolveVarRef(op.parent, variables);
          if (parentId) {
            const parent = figma.getNodeById(parentId);
            if (parent && 'appendChild' in parent) {
              (parent as FrameNode).appendChild(frame);
            }
          }
          if (op.props) await applyNodeProperties(frame, op.props);
          if (op.variable) variables.set(op.variable, frame.id);
          results.push({ op: op.op, variable: op.variable, nodeId: frame.id, success: true });
          break;
        }

        case 'CREATE_TEXT': {
          const text = figma.createText();

          // Load font before any text mutation
          const fontFamily = op.fontFamily || 'Inter';
          const fontStyle = op.fontStyle || 'Regular';
          let loadedFamily = fontFamily;
          let loadedStyle = fontStyle;
          try {
            await figma.loadFontAsync({ family: fontFamily, style: fontStyle });
          } catch {
            // Smart fallback: search for closest available style
            let found = false;
            try {
              const available = await figma.listAvailableFontsAsync();
              const familyFonts = available.filter(f => f.fontName.family === fontFamily);
              if (familyFonts.length > 0) {
                const exactMatch = familyFonts.find(f => f.fontName.style.toLowerCase() === fontStyle.toLowerCase());
                if (exactMatch) {
                  loadedStyle = exactMatch.fontName.style;
                  await figma.loadFontAsync({ family: loadedFamily, style: loadedStyle });
                  found = true;
                } else {
                  const regular = familyFonts.find(f => f.fontName.style === 'Regular');
                  const fallbackFont = regular || familyFonts[0];
                  loadedStyle = fallbackFont.fontName.style;
                  await figma.loadFontAsync({ family: loadedFamily, style: loadedStyle });
                  found = true;
                }
              }
            } catch { /* continue to fallback */ }
            if (!found) {
              loadedFamily = 'Inter';
              loadedStyle = 'Regular';
              await figma.loadFontAsync({ family: loadedFamily, style: loadedStyle });
            }
          }
          text.fontName = { family: loadedFamily, style: loadedStyle };

          // Set characters before appending (Figma requires font loaded first)
          if (op.props?.characters) {
            text.characters = op.props.characters;
            delete op.props.characters;
          }

          // Set fontSize early
          if (op.props?.fontSize) {
            text.fontSize = op.props.fontSize;
            delete op.props.fontSize;
          }

          const textParentId = resolveVarRef(op.parent, variables);
          if (textParentId) {
            const parent = figma.getNodeById(textParentId);
            if (parent && 'appendChild' in parent) {
              (parent as FrameNode).appendChild(text);
            }
          }

          // Apply remaining props
          if (op.props) await applyNodeProperties(text, op.props);
          if (op.variable) variables.set(op.variable, text.id);
          results.push({ op: op.op, variable: op.variable, nodeId: text.id, success: true });
          break;
        }

        case 'CREATE_RECT': {
          const rect = figma.createRectangle();
          const rectParentId = resolveVarRef(op.parent, variables);
          if (rectParentId) {
            const parent = figma.getNodeById(rectParentId);
            if (parent && 'appendChild' in parent) {
              (parent as FrameNode).appendChild(rect);
            }
          }
          if (op.props) await applyNodeProperties(rect, op.props);
          if (op.variable) variables.set(op.variable, rect.id);
          results.push({ op: op.op, variable: op.variable, nodeId: rect.id, success: true });
          break;
        }

        case 'SET_IMAGE_FILL': {
          const imgNodeId = resolveVarRef(op.nodeId, variables);
          if (!imgNodeId) throw new Error('SET_IMAGE_FILL: missing node reference');
          const imgNode = figma.getNodeById(imgNodeId);
          if (!imgNode) throw new Error(`SET_IMAGE_FILL: node not found: ${imgNodeId}`);
          if (!op.base64) throw new Error('SET_IMAGE_FILL: missing image data');

          const bytes = figma.base64Decode(op.base64);
          const image = figma.createImage(bytes);
          (imgNode as GeometryMixin).fills = [{
            type: 'IMAGE',
            scaleMode: (op.scaleMode || 'FILL') as ImagePaint['scaleMode'],
            imageHash: image.hash,
          }];
          results.push({ op: op.op, nodeId: imgNodeId, success: true });
          break;
        }

        case 'TRIM': {
          const trimNodeId = resolveVarRef(op.nodeId, variables);
          if (!trimNodeId) throw new Error('TRIM: missing node reference');
          const trimNode = figma.getNodeById(trimNodeId);
          if (!trimNode) throw new Error(`TRIM: node not found: ${trimNodeId}`);

          // Export the node as PNG, find content bounds, and resize
          const exportBytes = await (trimNode as ExportMixin).exportAsync({
            format: 'PNG',
            constraint: { type: 'SCALE', value: 1 },
          });
          // Use getImageContentBounds if available (via raw Figma API), otherwise skip
          // For now, trim is a no-op here — the backend's place_product handles trimming
          results.push({ op: op.op, nodeId: trimNodeId, success: true });
          break;
        }

        case 'UPDATE': {
          const updateNodeId = resolveVarRef(op.nodeId, variables);
          if (!updateNodeId) throw new Error('UPDATE: missing node reference');
          const updateNode = figma.getNodeById(updateNodeId);
          if (!updateNode) throw new Error(`UPDATE: node not found: ${updateNodeId}`);
          if (op.props) await applyNodeProperties(updateNode as SceneNode, op.props);
          results.push({ op: op.op, nodeId: updateNodeId, success: true });
          break;
        }

        case 'SET_GRADIENT': {
          const gradNodeId = resolveVarRef(op.nodeId, variables);
          if (!gradNodeId) throw new Error('SET_GRADIENT: missing node reference');
          const gradNode = figma.getNodeById(gradNodeId);
          if (!gradNode) throw new Error(`SET_GRADIENT: node not found: ${gradNodeId}`);

          const gradientType = op.props?.gradientType || 'GRADIENT_LINEAR';
          const figmaType = gradientType.startsWith('GRADIENT_') ? gradientType : `GRADIENT_${gradientType}`;

          const gradientFill: GradientPaint = {
            type: figmaType as GradientPaint['type'],
            gradientStops: (op.props?.gradientStops || []).map((s: any) => ({
              position: s.position,
              color: s.color,
            })),
            gradientTransform: op.props?.gradientTransform || [[1, 0, 0], [0, 1, 0]],
          };

          (gradNode as GeometryMixin).fills = [gradientFill];
          results.push({ op: op.op, nodeId: gradNodeId, success: true });
          break;
        }

        case 'ADD_EFFECT': {
          const effectNodeId = resolveVarRef(op.nodeId, variables);
          if (!effectNodeId) throw new Error('ADD_EFFECT: missing node reference');
          const effectNode = figma.getNodeById(effectNodeId);
          if (!effectNode) throw new Error(`ADD_EFFECT: node not found: ${effectNodeId}`);

          const existingEffects = [...((effectNode as BlendMixin).effects || [])];
          const newEffect: any = {
            type: op.props?.type || 'DROP_SHADOW',
            visible: true,
          };
          if (op.props?.radius !== undefined) newEffect.radius = op.props.radius;
          if (op.props?.color) newEffect.color = op.props.color;
          if (op.props?.offset) newEffect.offset = op.props.offset;
          if (op.props?.spread !== undefined) newEffect.spread = op.props.spread;

          existingEffects.push(newEffect as Effect);
          (effectNode as BlendMixin).effects = existingEffects;
          results.push({ op: op.op, nodeId: effectNodeId, success: true });
          break;
        }

        case 'DELETE': {
          const delNodeId = resolveVarRef(op.nodeId, variables);
          if (!delNodeId) throw new Error('DELETE: missing node reference');
          const delNode = figma.getNodeById(delNodeId);
          if (!delNode) throw new Error(`DELETE: node not found: ${delNodeId}`);
          delNode.remove();
          results.push({ op: op.op, nodeId: delNodeId, success: true });
          break;
        }

        case 'REPARENT': {
          const reparentNodeId = resolveVarRef(op.nodeId, variables);
          const newParentId = resolveVarRef(op.newParent, variables);
          if (!reparentNodeId) throw new Error('REPARENT: missing node reference');
          if (!newParentId) throw new Error('REPARENT: missing new parent reference');

          const reparentNode = figma.getNodeById(reparentNodeId) as SceneNode;
          const newParent = figma.getNodeById(newParentId) as FrameNode;
          if (!reparentNode) throw new Error(`REPARENT: node not found: ${reparentNodeId}`);
          if (!newParent) throw new Error(`REPARENT: parent not found: ${newParentId}`);

          if (op.index !== undefined) {
            newParent.insertChild(op.index, reparentNode);
          } else {
            newParent.appendChild(reparentNode);
          }
          results.push({ op: op.op, nodeId: reparentNodeId, success: true });
          break;
        }

        default:
          results.push({ op: op.op, success: false, error: `Unknown operation: ${op.op}` });
      }
    } catch (error: any) {
      results.push({
        op: op.op,
        variable: op.variable,
        success: false,
        error: error.message || String(error),
      });
      // Stop on first error — return partial results
      break;
    }
  }

  // Build variable bindings map for response
  const variableBindings: Record<string, string> = {};
  for (const [name, nodeId] of variables.entries()) {
    variableBindings[name] = nodeId;
  }

  sendResult(id, {
    results,
    variableBindings,
    errors: results.filter(r => !r.success),
  });
}

/**
 * Resolve a variable reference ($varName) or literal node ID.
 * Returns the resolved node ID or null.
 */
function resolveVarRef(ref: string | null | undefined, variables: Map<string, string>): string | null {
  if (ref === null || ref === undefined) return null;
  if (ref.startsWith('$')) {
    const varName = ref.substring(1);
    const resolved = variables.get(varName);
    if (!resolved) throw new Error(`Unresolved variable: ${ref}`);
    return resolved;
  }
  return ref;
}

// ─── Utilities ───

async function applyNodeProperties(node: SceneNode, props: any) {
  // Position and dimensions (LayoutMixin — most scene nodes except slices)
  const layoutNode = node as SceneNode & LayoutMixin;
  if (props.x !== undefined) layoutNode.x = props.x;
  if (props.y !== undefined) layoutNode.y = props.y;
  if (props.width !== undefined || props.height !== undefined) {
    layoutNode.resize(props.width ?? layoutNode.width, props.height ?? layoutNode.height);
  }
  if (props.rotation !== undefined) layoutNode.rotation = props.rotation;

  // Visual properties
  if (props.fills !== undefined) {
    const fillableNode = node as GeometryMixin;
    fillableNode.fills = props.fills;
  }
  if (props.strokes !== undefined) {
    const strokeableNode = node as GeometryMixin;
    strokeableNode.strokes = props.strokes;
  }
  if (props.strokeWeight !== undefined) {
    (node as GeometryMixin).strokeWeight = props.strokeWeight;
  }
  if (props.cornerRadius !== undefined) {
    (node as RectangleNode | FrameNode).cornerRadius = props.cornerRadius;
  }
  if (props.effects !== undefined) {
    (node as BlendMixin).effects = props.effects;
  }
  // Append effects (avoids read-serialize-write round-trip)
  if (props.addEffects && Array.isArray(props.addEffects)) {
    const existing = [...((node as BlendMixin).effects || [])];
    existing.push(...props.addEffects);
    (node as BlendMixin).effects = existing;
  }
  if (props.opacity !== undefined) {
    (node as BlendMixin).opacity = props.opacity;
  }
  if (props.visible !== undefined) node.visible = props.visible;
  if (props.locked !== undefined) node.locked = props.locked;
  if (props.name !== undefined) node.name = props.name;

  // Layout properties that apply to ANY child of an auto-layout frame (not just frames)
  if (props.layoutPositioning !== undefined) {
    (node as any).layoutPositioning = props.layoutPositioning;
  }
  if (props.layoutSizingHorizontal !== undefined) {
    (node as any).layoutSizingHorizontal = props.layoutSizingHorizontal;
  }
  if (props.layoutSizingVertical !== undefined) {
    (node as any).layoutSizingVertical = props.layoutSizingVertical;
  }

  // Auto-layout properties (FRAME only)
  if (node.type === 'FRAME') {
    const frame = node as FrameNode;
    if (props.layoutMode !== undefined) frame.layoutMode = props.layoutMode;
    if (props.itemSpacing !== undefined) frame.itemSpacing = props.itemSpacing;
    if (props.paddingTop !== undefined) frame.paddingTop = props.paddingTop;
    if (props.paddingRight !== undefined) frame.paddingRight = props.paddingRight;
    if (props.paddingBottom !== undefined) frame.paddingBottom = props.paddingBottom;
    if (props.paddingLeft !== undefined) frame.paddingLeft = props.paddingLeft;
    if (props.primaryAxisAlignItems !== undefined) frame.primaryAxisAlignItems = props.primaryAxisAlignItems;
    if (props.counterAxisAlignItems !== undefined) frame.counterAxisAlignItems = props.counterAxisAlignItems;

    // Auto-set FIXED sizing when explicit dimensions + layoutMode provided.
    // Without this, enabling layoutMode triggers HUG which shrinks the frame.
    // Only auto-set if NOT explicitly provided in props (user intent preserved).
    const hasExplicitDims = props.width !== undefined || props.height !== undefined;
    const isAutoLayout = props.layoutMode !== undefined && props.layoutMode !== 'NONE';
    if (hasExplicitDims && isAutoLayout) {
      if (props.primaryAxisSizingMode === undefined) {
        frame.primaryAxisSizingMode = 'FIXED';
      }
      if (props.counterAxisSizingMode === undefined) {
        frame.counterAxisSizingMode = 'FIXED';
      }
    }

    if (props.primaryAxisSizingMode !== undefined) frame.primaryAxisSizingMode = props.primaryAxisSizingMode;
    if (props.counterAxisSizingMode !== undefined) frame.counterAxisSizingMode = props.counterAxisSizingMode;
    if (props.clipsContent !== undefined) frame.clipsContent = props.clipsContent;

    // ALWAYS re-apply dimensions after layoutMode change — layoutMode triggers HUG
    // which shrinks the frame. Re-resize restores intended dimensions.
    if (hasExplicitDims && (isAutoLayout || props.primaryAxisSizingMode !== undefined || props.counterAxisSizingMode !== undefined)) {
      frame.resize(props.width ?? frame.width, props.height ?? frame.height);
    }
  }

  // Text properties (TEXT only)
  if (node.type === 'TEXT') {
    const text = node as TextNode;

    // Font must be loaded before ANY text mutation (characters, fontSize, etc.)
    // Load current font if no new font is being set
    if (props.fontName !== undefined) {
      await figma.loadFontAsync(props.fontName);
      text.fontName = props.fontName;
    } else if (props.fontWeight !== undefined) {
      const fontFamily = text.fontName !== figma.mixed ? text.fontName.family : 'Inter';
      const style = mapWeightToStyle(props.fontWeight);
      const fontName = { family: fontFamily, style };
      await figma.loadFontAsync(fontName);
      text.fontName = fontName;
    } else if (props.characters !== undefined || props.fontSize !== undefined) {
      // Must load the existing font before changing characters or fontSize
      const currentFont = text.fontName;
      if (currentFont !== figma.mixed) {
        await figma.loadFontAsync(currentFont);
      } else {
        await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
      }
    }

    if (props.fontSize !== undefined) text.fontSize = props.fontSize;
    if (props.characters !== undefined) text.characters = props.characters;
    if (props.textAlignHorizontal !== undefined) text.textAlignHorizontal = props.textAlignHorizontal;
    if (props.textAlignVertical !== undefined) text.textAlignVertical = props.textAlignVertical;
    if (props.textAutoResize !== undefined) text.textAutoResize = props.textAutoResize;
    if (props.lineHeight !== undefined) text.lineHeight = props.lineHeight;
    if (props.letterSpacing !== undefined) text.letterSpacing = props.letterSpacing;
    if (props.textCase !== undefined) text.textCase = props.textCase;
    if (props.textDecoration !== undefined) text.textDecoration = props.textDecoration;
  }
}

function mapWeightToStyle(weight: number): string {
  if (weight <= 200) return 'Ultralight';
  if (weight <= 300) return 'Light';
  if (weight <= 400) return 'Regular';
  if (weight <= 500) return 'Medium';
  if (weight <= 600) return 'SemiBold';
  if (weight <= 700) return 'Bold';
  return 'Black';
}

function serializeNode(node: SceneNode, maxDepth: number, currentDepth = 0): SerializedNode {
  // Cast to LayoutMixin for position/rotation access (most SceneNodes implement this)
  const ln = node as SceneNode & LayoutMixin;
  const base: SerializedNode = {
    id: node.id,
    type: node.type,
    name: node.name,
    x: ln.x,
    y: ln.y,
    width: ln.width,
    height: ln.height,
    rotation: ln.rotation !== 0 ? ln.rotation : undefined,
    visible: !node.visible ? false : undefined,
    locked: node.locked ? true : undefined,
  };

  // Visual properties — use 'as any' for mixed comparisons since
  // Figma's type narrowing with figma.mixed is unreliable across node types
  const geoNode = node as any;
  if ('fills' in node) {
    const fills = geoNode.fills;
    if (fills !== figma.mixed && Array.isArray(fills)) {
      base.fills = (fills as Paint[]).map(serializePaint);
    }
  }
  if ('strokes' in node) {
    const strokes = geoNode.strokes;
    if (strokes !== figma.mixed && Array.isArray(strokes)) {
      base.strokes = (strokes as Paint[]).map(serializePaint);
    }
  }
  if ('strokeWeight' in node) {
    base.strokeWeight = geoNode.strokeWeight as number;
  }
  if ('cornerRadius' in node) {
    const cr = geoNode.cornerRadius;
    if (cr !== figma.mixed) {
      base.cornerRadius = cr as number;
    }
  }
  if ('effects' in node) {
    const effects = geoNode.effects;
    if (effects !== figma.mixed && Array.isArray(effects)) {
      base.effects = (effects as Effect[]).map(serializeEffect);
    }
  }
  if ('opacity' in node && (node as BlendMixin).opacity !== 1) {
    base.opacity = (node as BlendMixin).opacity;
  }

  // Auto-layout properties (FRAME)
  if (node.type === 'FRAME') {
    const frame = node as FrameNode;
    base.layoutMode = frame.layoutMode as SerializedNode['layoutMode'];
    base.layoutPositioning = frame.layoutPositioning;
    if (frame.layoutMode !== 'NONE') {
      base.itemSpacing = frame.itemSpacing;
      base.paddingTop = frame.paddingTop;
      base.paddingRight = frame.paddingRight;
      base.paddingBottom = frame.paddingBottom;
      base.paddingLeft = frame.paddingLeft;
      base.primaryAxisAlignItems = frame.primaryAxisAlignItems;
      base.counterAxisAlignItems = frame.counterAxisAlignItems;
      base.primaryAxisSizingMode = frame.primaryAxisSizingMode;
      base.counterAxisSizingMode = frame.counterAxisSizingMode;
      base.layoutSizingHorizontal = frame.layoutSizingHorizontal;
      base.layoutSizingVertical = frame.layoutSizingVertical;
    }
    base.clipsContent = frame.clipsContent;
  }

  // Text properties (TEXT)
  if (node.type === 'TEXT') {
    const text = node as TextNode;
    const textAny = text as any; // for mixed-type comparisons
    base.characters = text.characters;
    base.fontSize = text.fontSize as number;
    base.fontName = textAny.fontName !== figma.mixed ? text.fontName as { family: string; style: string } : undefined;
    base.textAlignHorizontal = text.textAlignHorizontal;
    base.textAlignVertical = text.textAlignVertical;
    base.textAutoResize = text.textAutoResize;
    const lh = textAny.lineHeight;
    base.lineHeight = lh !== figma.mixed ? lh as SerializedNode['lineHeight'] : undefined;
    const ls = textAny.letterSpacing;
    base.letterSpacing = ls !== figma.mixed ? ls as SerializedNode['letterSpacing'] : undefined;
  }

  // Children (recursive, depth-limited)
  if ('children' in node && currentDepth < maxDepth) {
    base.children = (node as ChildrenMixin).children.map(child =>
      serializeNode(child as SceneNode, maxDepth, currentDepth + 1)
    );
  }

  return base;
}

function serializePaint(paint: Paint): SerializedPaint {
  const base: SerializedPaint = {
    type: paint.type,
    visible: paint.visible,
    opacity: paint.opacity,
  };

  if (paint.type === 'SOLID') {
    base.color = (paint as SolidPaint).color;
  } else if (paint.type.startsWith('GRADIENT')) {
    const gp = paint as GradientPaint;
    base.gradientStops = gp.gradientStops.map(s => ({ position: s.position, color: { ...s.color } }));
    base.gradientTransform = gp.gradientTransform;
  } else if (paint.type === 'IMAGE') {
    const ip = paint as ImagePaint;
    base.imageHash = ip.imageHash ?? undefined;
    base.scaleMode = ip.scaleMode;
    base.imageTransform = ip.imageTransform;
  }
  // VIDEO, PATTERN — serialize type only (no additional data needed)

  return base;
}

function serializeEffect(effect: Effect): SerializedEffect {
  const base: SerializedEffect = {
    type: effect.type,
    visible: effect.visible,
    radius: 'radius' in effect ? (effect as any).radius : undefined,
  };

  if ('color' in effect) {
    base.color = (effect as any).color;
  }
  if ('offset' in effect) {
    base.offset = (effect as any).offset;
  }
  if ('spread' in effect) {
    base.spread = (effect as any).spread;
  }

  return base;
}

function sendResult(id: string, data: any) {
  figma.ui.postMessage({
    type: 'result',
    id,
    data,
  } as PluginResponse);
}

function sendError(id: string, error: string) {
  figma.ui.postMessage({
    type: 'error',
    id,
    error,
  } as PluginResponse);
}
