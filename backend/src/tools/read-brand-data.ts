/**
 * read_brand_data tool
 *
 * Reads brand files (overview, product specs, concepts-log, learnings)
 * or lists available files in a brand directory.
 * No Bridge needed — reads directly from filesystem.
 */

import { z } from 'zod/v4';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Compute default paths from this file's location:
// This file: figma-plugin/backend/src/tools/read-brand-data.ts
// Project root: ../../../../ (static-ad-agent-v2/)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const DEFAULT_BRAND_ROOT = path.join(PROJECT_ROOT, 'brands');
const DEFAULT_LEARNINGS_PATH = path.join(PROJECT_ROOT, '.claude', 'taste', 'learnings.md');

function getBrandRoot(): string {
  return process.env.BRAND_DATA_ROOT || DEFAULT_BRAND_ROOT;
}

function getLearningsPath(): string {
  return process.env.LEARNINGS_PATH || DEFAULT_LEARNINGS_PATH;
}

export const readBrandDataSchema = z.object({
  brand: z.string().describe('Brand name (e.g., "sintra", "feno"). Use "_global" for cross-brand learnings.'),
  file: z.string().optional().describe('Relative path within brand directory (e.g., "brand/sintra-overview.md", "products/buddy/spec.md", "ads/concepts-log.md"). If omitted, returns directory listing of available files.'),
});

export type ReadBrandDataInput = z.infer<typeof readBrandDataSchema>;

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

/**
 * Recursively list all files under a directory, returning paths relative to rootDir.
 */
function listFilesRecursive(dir: string, rootDir: string): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFilesRecursive(fullPath, rootDir));
    } else {
      results.push(path.relative(rootDir, fullPath));
    }
  }
  return results.sort();
}

export async function readBrandData(input: ReadBrandDataInput): Promise<ToolResult> {
  // Handle _global learnings
  if (input.brand === '_global') {
    const learningsPath = getLearningsPath();
    if (!input.file || input.file === 'learnings.md') {
      try {
        const content = fs.readFileSync(learningsPath, 'utf-8');
        return { content: [{ type: 'text', text: content }] };
      } catch {
        return {
          content: [{ type: 'text', text: `Error: Could not read learnings file at ${learningsPath}` }],
          isError: true,
        };
      }
    }
    return {
      content: [{ type: 'text', text: 'For _global brand, only "learnings.md" is available.' }],
      isError: true,
    };
  }

  const brandRoot = getBrandRoot();

  // Case-insensitive brand matching: "Feno" → "feno"
  let brandName = input.brand;
  let brandDir = path.resolve(brandRoot, brandName);

  if (!fs.existsSync(brandDir)) {
    // Try lowercase
    const lowerName = brandName.toLowerCase();
    const lowerDir = path.resolve(brandRoot, lowerName);
    if (fs.existsSync(lowerDir)) {
      brandName = lowerName;
      brandDir = lowerDir;
    }
  }

  // Security: ensure resolved path stays within brand root
  const resolvedBrandRoot = path.resolve(brandRoot);
  if (!brandDir.startsWith(resolvedBrandRoot + path.sep) && brandDir !== resolvedBrandRoot) {
    return {
      content: [{ type: 'text', text: 'Error: Invalid brand path.' }],
      isError: true,
    };
  }

  // Check brand directory exists
  if (!fs.existsSync(brandDir)) {
    let availableBrands: string[] = [];
    try {
      availableBrands = fs.readdirSync(brandRoot)
        .filter(f => {
          try { return fs.statSync(path.join(brandRoot, f)).isDirectory(); } catch { return false; }
        });
    } catch (e) {
      return {
        content: [{ type: 'text', text: `Error: Could not read brand root at ${brandRoot}. Ensure the brands directory exists.` }],
        isError: true,
      };
    }
    return {
      content: [{ type: 'text', text: `Brand "${input.brand}" not found.\n\nAvailable brands:\n${availableBrands.map(b => `  - ${b}`).join('\n')}` }],
      isError: true,
    };
  }

  // No file specified — return directory listing
  if (!input.file) {
    const files = listFilesRecursive(brandDir, brandDir);
    // Group by top-level directory for readability
    const grouped: Record<string, string[]> = {};
    for (const f of files) {
      const topDir = f.includes(path.sep) ? f.split(path.sep)[0] : '(root)';
      if (!grouped[topDir]) grouped[topDir] = [];
      grouped[topDir].push(f);
    }

    let output = `Brand "${input.brand}" — ${files.length} files\n\n`;
    for (const [dir, dirFiles] of Object.entries(grouped)) {
      output += `${dir}/\n`;
      for (const f of dirFiles) {
        output += `  ${f}\n`;
      }
      output += '\n';
    }

    return { content: [{ type: 'text', text: output }] };
  }

  // File specified — resolve and read
  const filePath = path.resolve(brandDir, input.file);

  // Security: ensure file path stays within brand directory
  if (!filePath.startsWith(brandDir + path.sep) && filePath !== brandDir) {
    return {
      content: [{ type: 'text', text: 'Error: Path traversal not allowed.' }],
      isError: true,
    };
  }

  if (!fs.existsSync(filePath)) {
    // List files in the parent directory to help the user
    const parentDir = path.dirname(filePath);
    let hint = '';
    if (fs.existsSync(parentDir)) {
      const siblings = fs.readdirSync(parentDir);
      hint = `\n\nFiles in ${path.relative(brandDir, parentDir)}/:\n${siblings.map(s => `  - ${s}`).join('\n')}`;
    }
    return {
      content: [{ type: 'text', text: `File not found: ${input.file}${hint}` }],
      isError: true,
    };
  }

  // Check if it's a directory (user passed a directory path as file)
  if (fs.statSync(filePath).isDirectory()) {
    const files = listFilesRecursive(filePath, brandDir);
    return {
      content: [{ type: 'text', text: `"${input.file}" is a directory.\n\nContents:\n${files.map(f => `  ${f}`).join('\n')}` }],
    };
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  return { content: [{ type: 'text', text: content }] };
}
