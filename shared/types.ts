/**
 * Domain types for Figma Plugin Agent
 *
 * These types represent Figma nodes and their properties in a serialized format
 * that can be transferred over WebSocket and stored in JSON.
 */

/**
 * Minimal node info for selection context
 */
export interface NodeInfo {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize?: number;
  characters?: string;
}

/**
 * Full recursive serialization of a Figma node
 * Used for checkpoint/restore functionality
 */
export interface SerializedNode {
  id: string;
  type: string;
  name: string;

  // Position and dimensions
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;

  // Visual properties
  fills?: SerializedPaint[];
  strokes?: SerializedPaint[];
  strokeWeight?: number;
  strokeAlign?: 'INSIDE' | 'OUTSIDE' | 'CENTER';
  cornerRadius?: number;
  cornerRadii?: [number, number, number, number]; // [topLeft, topRight, bottomRight, bottomLeft]
  effects?: SerializedEffect[];
  opacity?: number;
  blendMode?: string;
  visible?: boolean;
  locked?: boolean;

  // Auto-layout properties (for FRAME nodes)
  layoutMode?: 'NONE' | 'HORIZONTAL' | 'VERTICAL' | 'GRID';
  layoutPositioning?: 'AUTO' | 'ABSOLUTE';
  itemSpacing?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  primaryAxisAlignItems?: 'MIN' | 'MAX' | 'CENTER' | 'SPACE_BETWEEN';
  counterAxisAlignItems?: 'MIN' | 'MAX' | 'CENTER' | 'BASELINE';
  primaryAxisSizingMode?: 'FIXED' | 'AUTO';
  counterAxisSizingMode?: 'FIXED' | 'AUTO';
  layoutSizingHorizontal?: 'FIXED' | 'HUG' | 'FILL';
  layoutSizingVertical?: 'FIXED' | 'HUG' | 'FILL';
  clipsContent?: boolean;

  // Text properties (for TEXT nodes)
  characters?: string;
  fontSize?: number;
  fontName?: { family: string; style: string };
  fontWeight?: number;
  textAlignHorizontal?: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
  textAlignVertical?: 'TOP' | 'CENTER' | 'BOTTOM';
  textAutoResize?: 'NONE' | 'WIDTH_AND_HEIGHT' | 'HEIGHT' | 'TRUNCATE';
  lineHeight?: { value?: number; unit: 'PIXELS' | 'PERCENT' | 'AUTO' };
  letterSpacing?: { value: number; unit: 'PIXELS' | 'PERCENT' };
  textCase?: 'ORIGINAL' | 'UPPER' | 'LOWER' | 'TITLE';
  textDecoration?: 'NONE' | 'UNDERLINE' | 'STRIKETHROUGH';

  // Image properties (for nodes with image fills)
  imageHash?: string; // Figma's internal image hash

  // Constraints
  constraints?: {
    horizontal: 'MIN' | 'MAX' | 'CENTER' | 'STRETCH' | 'SCALE';
    vertical: 'MIN' | 'MAX' | 'CENTER' | 'STRETCH' | 'SCALE';
  };

  // Children (recursive)
  children?: SerializedNode[];
}

/**
 * Serialized paint (fill or stroke)
 */
export interface SerializedPaint {
  type: string; // SOLID, GRADIENT_LINEAR, GRADIENT_RADIAL, GRADIENT_ANGULAR, GRADIENT_DIAMOND, IMAGE, VIDEO, PATTERN
  visible?: boolean;
  opacity?: number;

  // For SOLID
  color?: { r: number; g: number; b: number };

  // For GRADIENT_*
  gradientStops?: Array<{
    position: number;
    color: { r: number; g: number; b: number; a: number };
  }>;
  gradientTransform?: number[][];

  // For IMAGE
  imageHash?: string;
  scaleMode?: 'FILL' | 'FIT' | 'CROP' | 'TILE';
  imageTransform?: number[][];
}

/**
 * Serialized effect (shadow, blur, etc.)
 */
export interface SerializedEffect {
  type: string; // DROP_SHADOW, INNER_SHADOW, LAYER_BLUR, BACKGROUND_BLUR, NOISE, TEXTURE, GLASS
  visible?: boolean;
  radius?: number;

  // For shadows
  color?: { r: number; g: number; b: number; a: number };
  offset?: { x: number; y: number };
  spread?: number;
  blendMode?: string;
}

/**
 * Canvas state snapshot
 * Returned by get_frame_state for agent inspection
 */
export interface CanvasState {
  frameId: string;
  nodes: NodeInfo[];
  structure: SerializedNode;
}
