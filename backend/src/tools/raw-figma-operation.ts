/**
 * raw_figma_operation tool
 *
 * Escape hatch for arbitrary Figma API calls.
 * Logs to telemetry to track which raw operations are commonly needed.
 * If patterns emerge, they should be promoted to dedicated tools.
 */

import { z } from 'zod';
import type { Bridge } from '../bridge.js';
import { logRawOperation } from '../telemetry/tracker.js';

export const rawFigmaOperationSchema = z.object({
  method: z.string().describe('Figma API method name'),
  args: z.array(z.any()).describe('Method arguments array'),
  reason: z
    .string()
    .optional()
    .describe('Brief explanation of why this raw operation is needed (helps identify missing tools)'),
});

export type RawFigmaOperationInput = z.infer<typeof rawFigmaOperationSchema>;

export async function rawFigmaOperation(input: RawFigmaOperationInput, bridge: Bridge): Promise<any> {
  // Log to centralized telemetry for pattern analysis
  logRawOperation({
    timestamp: new Date().toISOString(),
    method: input.method,
    args: input.args,
    reason: input.reason || 'not specified',
  });

  const result = await bridge.sendCommand({
    type: 'figma_call',
    method: input.method,
    args: input.args,
  });

  return {
    result,
    message: `Executed raw operation: ${input.method}`,
  };
}
