/**
 * Template Library tools
 *
 * Save completed ads as reusable templates, browse them with thumbnails,
 * and apply them as starting points for new concepts.
 *
 * Data storage: backend/data/templates/
 *   - index.json — array of TemplateEntry objects
 *   - {templateId}/frame.json — serialized frame data
 *   - {templateId}/thumbnail.png — screenshot
 */

import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { Bridge } from '../bridge.js';

type ToolResult = {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }
  >;
  isError?: boolean;
};

type TemplateEntry = {
  templateId: string;
  name: string;
  formatCategory?: string;
  brand?: string;
  dimensions?: { width: number; height: number };
  tags?: string[];
  description?: string;
  thumbnailPath: string;
  framePath: string;
  createdAt: string;
};

const TEMPLATES_DIR = join(process.cwd(), 'backend', 'data', 'templates');
const INDEX_PATH = join(TEMPLATES_DIR, 'index.json');

function ensureTemplatesDir() {
  mkdirSync(TEMPLATES_DIR, { recursive: true });
}

function readIndex(): TemplateEntry[] {
  if (!existsSync(INDEX_PATH)) return [];
  try {
    return JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
  } catch {
    return [];
  }
}

function writeIndex(entries: TemplateEntry[]) {
  writeFileSync(INDEX_PATH, JSON.stringify(entries, null, 2), 'utf8');
}

// ─── save_template ───

export const saveTemplateSchema = z.object({
  frameId: z.string().describe('Frame ID to save as template'),
  name: z.string().describe('Template name (e.g., "Dark Story — Borrowed Interface")'),
  formatCategory: z.string().optional().describe('Format category (Editorial, Comparison, etc.)'),
  brand: z.string().optional().describe('Brand this template was designed for'),
  tags: z.array(z.string()).optional().describe('Searchable tags (e.g., ["dark", "story", "IG"])'),
  description: z.string().optional().describe('Brief description of the template layout and style'),
});

export type SaveTemplateInput = z.infer<typeof saveTemplateSchema>;

export async function saveTemplate(input: SaveTemplateInput, bridge: Bridge): Promise<any> {
  ensureTemplatesDir();

  const templateId = uuidv4();
  const templateDir = join(TEMPLATES_DIR, templateId);
  mkdirSync(templateDir, { recursive: true });

  // 1. Serialize the frame tree
  const serialized = await bridge.sendCommand({
    type: 'serialize_frame',
    frameId: input.frameId,
  });

  if (!serialized || !serialized.id) {
    throw new Error(`Failed to serialize frame ${input.frameId}`);
  }

  const framePath = join(templateDir, 'frame.json');
  writeFileSync(framePath, JSON.stringify(serialized, null, 2), 'utf8');

  // 2. Take a thumbnail screenshot
  const exported = await bridge.sendCommand({
    type: 'export_node',
    nodeId: input.frameId,
    format: 'PNG',
    scale: 0.5,
  });

  const thumbnailPath = join(templateDir, 'thumbnail.png');
  if (exported?.base64) {
    writeFileSync(thumbnailPath, Buffer.from(exported.base64, 'base64'));
  }

  // 3. Extract dimensions from serialized data
  const dimensions = serialized.width && serialized.height
    ? { width: serialized.width, height: serialized.height }
    : undefined;

  // 4. Update index
  const index = readIndex();
  const entry: TemplateEntry = {
    templateId,
    name: input.name,
    formatCategory: input.formatCategory,
    brand: input.brand,
    dimensions,
    tags: input.tags,
    description: input.description,
    thumbnailPath: `${templateId}/thumbnail.png`,
    framePath: `${templateId}/frame.json`,
    createdAt: new Date().toISOString(),
  };
  index.push(entry);
  writeIndex(index);

  return {
    templateId,
    name: input.name,
    message: `Template "${input.name}" saved (${templateId})`,
  };
}

// ─── browse_templates ───

export const browseTemplatesSchema = z.object({
  query: z.string().optional().describe('Search query (matches name, tags, description)'),
  formatCategory: z.string().optional().describe('Filter by format category'),
  brand: z.string().optional().describe('Filter by brand'),
  limit: z.number().optional().describe('Max results (default: 10)'),
});

export type BrowseTemplatesInput = z.infer<typeof browseTemplatesSchema>;

export async function browseTemplates(input: BrowseTemplatesInput): Promise<ToolResult> {
  const index = readIndex();
  const limit = input.limit || 10;

  // Filter
  let matches = index;

  if (input.formatCategory) {
    matches = matches.filter(t =>
      t.formatCategory?.toLowerCase() === input.formatCategory!.toLowerCase()
    );
  }

  if (input.brand) {
    matches = matches.filter(t =>
      t.brand?.toLowerCase() === input.brand!.toLowerCase()
    );
  }

  if (input.query) {
    const q = input.query.toLowerCase();
    matches = matches.filter(t => {
      const searchable = [
        t.name,
        t.description || '',
        ...(t.tags || []),
        t.formatCategory || '',
      ].join(' ').toLowerCase();
      return searchable.includes(q);
    });
  }

  // Limit results
  matches = matches.slice(0, limit);

  if (matches.length === 0) {
    return {
      content: [{
        type: 'text',
        text: `No templates found${input.query ? ` matching "${input.query}"` : ''}. Total templates: ${index.length}`,
      }],
    };
  }

  // Build response with thumbnails
  const content: ToolResult['content'] = [];
  content.push({
    type: 'text',
    text: `Found ${matches.length} template${matches.length !== 1 ? 's' : ''} (${index.length} total):`,
  });

  for (const t of matches) {
    // Text description
    const dims = t.dimensions ? `${t.dimensions.width}x${t.dimensions.height}` : 'unknown';
    const meta: string[] = [];
    if (t.formatCategory) meta.push(t.formatCategory);
    if (t.brand) meta.push(t.brand);
    if (t.tags?.length) meta.push(`tags: ${t.tags.join(', ')}`);

    content.push({
      type: 'text',
      text: `\n**${t.name}** (${dims}) — id: ${t.templateId}\n${meta.join(' | ')}${t.description ? `\n${t.description}` : ''}`,
    });

    // Thumbnail
    const thumbAbsPath = join(TEMPLATES_DIR, t.thumbnailPath);
    if (existsSync(thumbAbsPath)) {
      try {
        const imgData = readFileSync(thumbAbsPath);
        content.push({
          type: 'image',
          data: imgData.toString('base64'),
          mimeType: 'image/png',
        });
      } catch {
        content.push({ type: 'text', text: '  (thumbnail unavailable)' });
      }
    }
  }

  return { content };
}

// ─── apply_template ───

export const applyTemplateSchema = z.object({
  templateId: z.string().describe('Template ID to apply'),
  x: z.number().optional().describe('X position for the new frame (default: 0)'),
  y: z.number().optional().describe('Y position for the new frame (default: 0)'),
  name: z.string().optional().describe('Override the frame name'),
});

export type ApplyTemplateInput = z.infer<typeof applyTemplateSchema>;

export async function applyTemplate(input: ApplyTemplateInput, bridge: Bridge): Promise<any> {
  // 1. Read template data
  const index = readIndex();
  const entry = index.find(t => t.templateId === input.templateId);
  if (!entry) {
    const available = index.map(t => `${t.name} (${t.templateId.substring(0, 8)}...)`).join(', ');
    throw new Error(
      `Template "${input.templateId}" not found. Available: ${available || 'none'}`
    );
  }

  const framePath = join(TEMPLATES_DIR, entry.framePath);
  if (!existsSync(framePath)) {
    throw new Error(`Template frame data missing at ${framePath}`);
  }

  const serialized = JSON.parse(readFileSync(framePath, 'utf8'));

  // 2. Extract dimensions
  const width = serialized.width || 1080;
  const height = serialized.height || 1920;
  const x = input.x ?? 0;
  const y = input.y ?? 0;

  // 3. Create a new empty frame with the template dimensions
  const frameResult = await bridge.sendCommand({
    type: 'figma_call',
    method: 'createFrame',
    args: [{
      width,
      height,
      x,
      y,
      name: input.name || entry.name,
      fills: [], // Will be restored from template
    }],
  });

  const newFrameId = frameResult.id;

  // 4. Restore the serialized node tree into the new frame
  await bridge.sendCommand({
    type: 'restore_checkpoint',
    frameId: newFrameId,
    serialized,
  });

  return {
    frameId: newFrameId,
    templateId: input.templateId,
    templateName: entry.name,
    dimensions: { width, height },
    message: `Applied template "${entry.name}" → frame ${newFrameId} (${width}x${height})`,
  };
}
