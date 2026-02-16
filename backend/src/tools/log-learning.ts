/**
 * log_learning tool
 *
 * Records design learnings and principles discovered during a session.
 * Writes to brand-specific or universal learnings files.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod/v4';

// Compute default paths from this file's location
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function getBrandRoot(): string {
  return process.env.BRAND_DATA_ROOT || path.join(PROJECT_ROOT, 'brands');
}

function getLearningsPath(): string {
  return process.env.LEARNINGS_PATH || path.join(PROJECT_ROOT, '.claude', 'taste', 'learnings.md');
}

export const logLearningSchema = z.object({
  text: z.string().describe('The learning/principle to record'),
  brand: z.string().optional().describe('Brand name (required when scope is "brand")'),
  scope: z.enum(['brand', 'universal']).optional().describe('Where to save. "brand" = brand-specific learnings file. "universal" = cross-brand learnings. Default: "brand".'),
  category: z.string().optional().describe('Category tag: typography, spacing, composition, color, concept, execution, etc.'),
});

export type LogLearningInput = z.infer<typeof logLearningSchema>;

export async function logLearning(input: LogLearningInput): Promise<any> {
  const scope = input.scope || 'brand';
  const category = input.category || 'General';
  const date = new Date().toISOString().split('T')[0];

  let targetPath: string;

  if (scope === 'universal') {
    targetPath = getLearningsPath();
  } else {
    if (!input.brand) {
      return {
        error: 'Brand name is required when scope is "brand".',
      };
    }
    targetPath = path.join(getBrandRoot(), input.brand.toLowerCase(), 'learnings.md');
  }

  // Ensure parent directory exists
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });

  // Format the entry
  const entry = `\n### ${category} (${date})\n${input.text}\n`;

  // Create file with header if it doesn't exist
  if (!fs.existsSync(targetPath)) {
    const header = scope === 'universal'
      ? '# Design Learnings\n\nCross-brand principles discovered during sessions.\n'
      : `# Learnings\n\nBrand-specific learnings for ${input.brand}.\n`;
    fs.writeFileSync(targetPath, header + entry, 'utf-8');
  } else {
    fs.appendFileSync(targetPath, entry, 'utf-8');
  }

  return {
    message: `Learning logged (${scope}/${category}): ${input.text.substring(0, 80)}...`,
    path: targetPath,
    date,
  };
}
