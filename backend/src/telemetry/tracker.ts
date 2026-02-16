/**
 * Centralized telemetry tracker
 *
 * Logs raw_figma_operation and batch_operations usage patterns.
 * At session end, analyzes patterns and generates draft tool definitions
 * for frequently repeated operations.
 */

import { mkdirSync, appendFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { saveDrafts, generateDraftFile } from './draft-generator.js';

const TELEMETRY_DIR = join(process.cwd(), 'backend', 'data', 'telemetry');
const RAW_OPS_FILE = join(TELEMETRY_DIR, 'raw-operations.jsonl');
const BATCH_OPS_FILE = join(TELEMETRY_DIR, 'batch-operations.jsonl');

function ensureDir() {
  mkdirSync(TELEMETRY_DIR, { recursive: true });
}

export type RawOperationEntry = {
  timestamp: string;
  method: string;
  args: any[];
  reason?: string;
};

export type BatchOperationsEntry = {
  timestamp: string;
  opCount: number;
  opSequence: string; // e.g., "CREATE_FRAME,CREATE_TEXT,CREATE_TEXT,UPDATE"
  operations: Array<{
    op: string;
    propsKeys?: string[];
  }>;
};

export type ToolDraft = {
  name: string;
  description: string;
  source: 'raw_figma_operation' | 'batch_operations';
  pattern: string;
  frequency: number;
  examples: any[];
};

/**
 * Log a raw_figma_operation usage.
 */
export function logRawOperation(entry: RawOperationEntry): void {
  try {
    ensureDir();
    appendFileSync(RAW_OPS_FILE, JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    console.warn('[Telemetry] Failed to log raw operation:', err);
  }
}

/**
 * Log a batch_operations execution.
 */
export function logBatchOperations(entry: BatchOperationsEntry): void {
  try {
    ensureDir();
    appendFileSync(BATCH_OPS_FILE, JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    console.warn('[Telemetry] Failed to log batch operations:', err);
  }
}

/**
 * Analyze telemetry data for recurring patterns.
 * Returns draft tool definitions for patterns appearing 5+ times.
 */
export function analyzePatterns(): ToolDraft[] {
  const drafts: ToolDraft[] = [];

  // --- Analyze raw_figma_operation patterns ---
  if (existsSync(RAW_OPS_FILE)) {
    try {
      const lines = readFileSync(RAW_OPS_FILE, 'utf8').trim().split('\n').filter(l => l);
      const methodCounts = new Map<string, { count: number; examples: RawOperationEntry[] }>();

      for (const line of lines) {
        try {
          const entry: RawOperationEntry = JSON.parse(line);
          const existing = methodCounts.get(entry.method);
          if (existing) {
            existing.count++;
            if (existing.examples.length < 3) existing.examples.push(entry);
          } else {
            methodCounts.set(entry.method, { count: 1, examples: [entry] });
          }
        } catch { /* skip malformed lines */ }
      }

      for (const [method, data] of methodCounts.entries()) {
        if (data.count >= 5) {
          drafts.push({
            name: methodToToolName(method),
            description: `Wraps raw Figma API method "${method}" — used ${data.count} times via raw_figma_operation.`,
            source: 'raw_figma_operation',
            pattern: method,
            frequency: data.count,
            examples: data.examples,
          });
        }
      }
    } catch (err) {
      console.warn('[Telemetry] Failed to analyze raw operations:', err);
    }
  }

  // --- Analyze batch_operations patterns ---
  if (existsSync(BATCH_OPS_FILE)) {
    try {
      const lines = readFileSync(BATCH_OPS_FILE, 'utf8').trim().split('\n').filter(l => l);
      const seqCounts = new Map<string, { count: number; examples: BatchOperationsEntry[] }>();

      for (const line of lines) {
        try {
          const entry: BatchOperationsEntry = JSON.parse(line);
          const existing = seqCounts.get(entry.opSequence);
          if (existing) {
            existing.count++;
            if (existing.examples.length < 3) existing.examples.push(entry);
          } else {
            seqCounts.set(entry.opSequence, { count: 1, examples: [entry] });
          }
        } catch { /* skip malformed lines */ }
      }

      for (const [sequence, data] of seqCounts.entries()) {
        if (data.count >= 5) {
          drafts.push({
            name: sequenceToToolName(sequence),
            description: `Batch operation sequence "${sequence}" — used ${data.count} times.`,
            source: 'batch_operations',
            pattern: sequence,
            frequency: data.count,
            examples: data.examples,
          });
        }
      }
    } catch (err) {
      console.warn('[Telemetry] Failed to analyze batch operations:', err);
    }
  }

  return drafts;
}

/**
 * Convert a Figma API method name to a tool name.
 * e.g., "createRoundedRect" → "create_rounded_rect"
 */
function methodToToolName(method: string): string {
  return method
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '');
}

/**
 * Convert an operation sequence to a descriptive tool name.
 * e.g., "CREATE_FRAME,CREATE_TEXT,CREATE_TEXT" → "text_card"
 */
function sequenceToToolName(sequence: string): string {
  const ops = sequence.split(',');
  const frameCount = ops.filter(o => o === 'CREATE_FRAME').length;
  const textCount = ops.filter(o => o === 'CREATE_TEXT').length;
  const rectCount = ops.filter(o => o === 'CREATE_RECT').length;

  if (frameCount >= 1 && textCount >= 2) return 'text_card_layout';
  if (frameCount >= 2 && textCount >= 1) return 'nested_frame_layout';
  if (rectCount >= 2) return 'shape_composition';
  return `custom_pattern_${ops.length}_ops`;
}

/**
 * Run the full analysis and save draft files.
 * Called at session end from stop hooks.
 */
export function runAnalysisAndSaveDrafts(): void {
  const drafts = analyzePatterns();
  if (drafts.length > 0) {
    console.log(`[Telemetry] Found ${drafts.length} tool draft candidates`);
    saveDrafts(drafts);
  } else {
    console.log('[Telemetry] No tool patterns detected (need 5+ repetitions)');
  }
}
