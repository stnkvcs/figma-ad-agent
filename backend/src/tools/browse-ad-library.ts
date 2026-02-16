/**
 * browse_ad_library tool
 *
 * Queries the ad library SQLite database and returns thumbnails
 * for visual browsing. No Bridge needed — reads filesystem + SQLite.
 */

import { z } from 'zod/v4';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

// Compute default path from this file's location
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const DEFAULT_AD_LIBRARY_ROOT = path.join(PROJECT_ROOT, 'ad-library');

function getAdLibraryRoot(): string {
  return process.env.AD_LIBRARY_ROOT || DEFAULT_AD_LIBRARY_ROOT;
}

export const browseAdLibrarySchema = z.object({
  categories: z.array(z.string()).describe('Category names to browse (e.g., ["Comparison", "Before & After", "Strong Copy"])'),
  count: z.number().optional().describe('Thumbnails per category to return (default: 5, max: 8)'),
  aspectRatio: z.string().optional().describe('Filter by aspect ratio: "9:16", "1:1", etc.'),
});

export type BrowseAdLibraryInput = z.infer<typeof browseAdLibrarySchema>;

type ToolResult = {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }
  >;
  isError?: boolean;
};

// Cached DB connection (opened once, reused across calls)
let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;

  const adLibraryRoot = getAdLibraryRoot();
  if (!adLibraryRoot) {
    throw new Error('AD_LIBRARY_ROOT environment variable not set.');
  }

  const dbPath = path.join(adLibraryRoot, '_index', 'library.db');
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Library database not found at ${dbPath}`);
  }

  db = new Database(dbPath, { readonly: true });
  return db;
}

export async function browseAdLibrary(input: BrowseAdLibraryInput): Promise<ToolResult> {
  const adLibraryRoot = getAdLibraryRoot();
  if (!adLibraryRoot) {
    return {
      content: [{ type: 'text', text: 'Error: AD_LIBRARY_ROOT environment variable not set.' }],
      isError: true,
    };
  }

  let database: Database.Database;
  try {
    database = getDb();
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error opening database: ${err instanceof Error ? err.message : String(err)}` }],
      isError: true,
    };
  }

  const count = Math.min(input.count ?? 5, 8);
  const content: ToolResult['content'] = [];

  for (const category of input.categories) {
    // Get total count for this category
    const countQuery = input.aspectRatio
      ? 'SELECT COUNT(*) as total FROM images WHERE category = ? AND aspect_ratio_label = ?'
      : 'SELECT COUNT(*) as total FROM images WHERE category = ?';
    const countParams = input.aspectRatio ? [category, input.aspectRatio] : [category];
    const countRow = database.prepare(countQuery).get(...countParams) as { total: number } | undefined;
    const totalCount = countRow?.total ?? 0;

    if (totalCount === 0) {
      // List available categories to help the user
      const allCategories = database.prepare('SELECT DISTINCT category FROM images ORDER BY category').all() as { category: string }[];
      const categoryList = allCategories.map(r => r.category).join(', ');
      content.push({
        type: 'text',
        text: `Category "${category}" — no ads found${input.aspectRatio ? ` with aspect ratio ${input.aspectRatio}` : ''}.\n\nAvailable categories: ${categoryList}`,
      });
      continue;
    }

    // Query ads with thumbnails
    const selectQuery = input.aspectRatio
      ? 'SELECT filepath, filename, thumbnail_path, width, height, dominant_colors FROM images WHERE category = ? AND aspect_ratio_label = ? LIMIT ?'
      : 'SELECT filepath, filename, thumbnail_path, width, height, dominant_colors FROM images WHERE category = ? LIMIT ?';
    const selectParams = input.aspectRatio ? [category, input.aspectRatio, count] : [category, count];
    const rows = database.prepare(selectQuery).all(...selectParams) as Array<{
      filepath: string;
      filename: string;
      thumbnail_path: string | null;
      width: number;
      height: number;
      dominant_colors: string | null;
    }>;

    content.push({
      type: 'text',
      text: `\n--- Category: ${category} (${totalCount} total ads, showing ${rows.length}) ---`,
    });

    for (const row of rows) {
      // Try to resolve thumbnail path
      let thumbnailPath: string | null = null;

      if (row.thumbnail_path) {
        // Thumbnail path from DB is relative to AD_LIBRARY_ROOT
        const candidatePath = path.resolve(adLibraryRoot, row.thumbnail_path);
        if (fs.existsSync(candidatePath)) {
          thumbnailPath = candidatePath;
        }
      }

      // Fallback: construct from category and filename
      if (!thumbnailPath) {
        const thumbName = row.filename.replace(/\.[^.]+$/, '_thumb.jpg');
        const fallbackPath = path.join(adLibraryRoot, '_index', 'thumbnails', category, thumbName);
        if (fs.existsSync(fallbackPath)) {
          thumbnailPath = fallbackPath;
        }
      }

      // Build text description
      const colors = row.dominant_colors || 'N/A';
      content.push({
        type: 'text',
        text: `${row.filename} — ${row.width}x${row.height} | Colors: ${colors}`,
      });

      // Add thumbnail image if available
      if (thumbnailPath) {
        try {
          const imageData = fs.readFileSync(thumbnailPath);
          const base64Data = imageData.toString('base64');
          content.push({
            type: 'image',
            data: base64Data,
            mimeType: 'image/jpeg',
          });
        } catch {
          content.push({
            type: 'text',
            text: `  (thumbnail unavailable: ${thumbnailPath})`,
          });
        }
      } else {
        content.push({
          type: 'text',
          text: `  (no thumbnail found)`,
        });
      }
    }
  }

  if (content.length === 0) {
    content.push({ type: 'text', text: 'No results found.' });
  }

  return { content };
}
