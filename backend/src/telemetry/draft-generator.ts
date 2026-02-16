/**
 * Draft tool generator
 *
 * Generates skeleton TypeScript tool files from telemetry patterns.
 * Drafts are saved to backend/src/tools/_drafts/ for manual review and promotion.
 */

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { ToolDraft } from './tracker.js';

const DRAFTS_DIR = join(process.cwd(), 'backend', 'src', 'tools', '_drafts');

/**
 * Generate a TypeScript tool file string from a ToolDraft.
 */
export function generateDraftFile(draft: ToolDraft): string {
  const schemaName = `${camelCase(draft.name)}Schema`;
  const functionName = camelCase(draft.name);

  // Build example comments from telemetry data
  const exampleLines = draft.examples
    .slice(0, 3)
    .map((ex, i) => `//   ${i + 1}. ${JSON.stringify(ex).substring(0, 200)}`)
    .join('\n');

  if (draft.source === 'raw_figma_operation') {
    return `/**
 * ${draft.name} tool (AUTO-GENERATED DRAFT)
 *
 * ${draft.description}
 * Detected from ${draft.frequency} raw_figma_operation calls.
 *
 * Usage examples from telemetry:
${exampleLines}
 *
 * TODO: Review, refine schema, add proper error handling, then move to ../
 */

import { z } from 'zod';
import type { Bridge } from '../../bridge.js';

export const ${schemaName} = z.object({
  // TODO: Define typed schema based on observed args patterns
  args: z.array(z.any()).describe('Arguments for ${draft.pattern}'),
});

export type ${pascalCase(draft.name)}Input = z.infer<typeof ${schemaName}>;

export async function ${functionName}(input: ${pascalCase(draft.name)}Input, bridge: Bridge): Promise<any> {
  const result = await bridge.sendCommand({
    type: 'figma_call',
    method: '${draft.pattern}',
    args: input.args,
  });

  return {
    result,
    message: \`Executed ${draft.name}\`,
  };
}
`;
  }

  // batch_operations pattern
  return `/**
 * ${draft.name} tool (AUTO-GENERATED DRAFT)
 *
 * ${draft.description}
 * Detected from ${draft.frequency} identical batch_operations sequences.
 *
 * Operation sequence: ${draft.pattern}
 *
 * Usage examples from telemetry:
${exampleLines}
 *
 * TODO: Review, define typed schema, extract common parameters, then move to ../
 */

import { z } from 'zod';
import type { Bridge } from '../../bridge.js';

export const ${schemaName} = z.object({
  parentId: z.string().describe('Parent frame ID'),
  // TODO: Extract common parameters from observed patterns
});

export type ${pascalCase(draft.name)}Input = z.infer<typeof ${schemaName}>;

export async function ${functionName}(input: ${pascalCase(draft.name)}Input, bridge: Bridge): Promise<any> {
  // TODO: Implement using the observed pattern:
  // ${draft.pattern.split(',').join(' → ')}

  return {
    message: \`Executed ${draft.name} pattern\`,
  };
}
`;
}

/**
 * Save draft tool files to the _drafts directory.
 */
export function saveDrafts(drafts: ToolDraft[]): void {
  mkdirSync(DRAFTS_DIR, { recursive: true });

  for (const draft of drafts) {
    const fileName = `${draft.name}.ts`;
    const filePath = join(DRAFTS_DIR, fileName);
    const content = generateDraftFile(draft);

    try {
      writeFileSync(filePath, content, 'utf8');
      console.log(`[Telemetry] Draft saved: ${filePath}`);
    } catch (err) {
      console.warn(`[Telemetry] Failed to save draft ${fileName}:`, err);
    }
  }
}

function camelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function pascalCase(str: string): string {
  const cc = camelCase(str);
  return cc.charAt(0).toUpperCase() + cc.slice(1);
}
