/**
 * generate_asset tool
 *
 * Uses fal.ai Nano Banana Pro T2I API to generate assets from text prompts.
 * Supports backgrounds, UI elements, props, textures, and people with
 * type-specific prompt engineering.
 *
 * Pattern from terminal workflow: asset-generation skill
 */

import { z } from 'zod';
import { mkdirSync, readFileSync } from 'fs';
import path from 'path';
import { uploadFile, downloadImage, fal } from '../fal-client.js';
import { getSessionState } from '../session-state.js';
import { getImageDimensions } from './image-analysis.js';

// Type-specific prompt prefixes for better results
const TYPE_PREFIXES: Record<string, (prompt: string) => string> = {
  ui_element: (p) => `High-fidelity screenshot of ${p}. Photorealistic UI rendering, pixel-perfect, native styling.`,
  background: (p) => `Abstract background: ${p}. Seamless, high-resolution, suitable as ad background.`,
  prop: (p) => `Product photography prop: ${p}. Studio lighting, clean composition.`,
  texture: (p) => `Seamless texture: ${p}. Tileable, high-resolution.`,
  person: (p) => `${p}. Professional photography, natural lighting, authentic.`,
};

export const generateAssetSchema = z.object({
  prompt: z.string().describe('Description of the asset to generate'),
  type: z.enum(['background', 'ui_element', 'prop', 'texture', 'person']).describe('Asset type — affects prompt engineering'),
  aspectRatio: z.enum(['9:16', '1:1', '16:9', '4:3', '3:4', '4:5', '5:4', '3:2', '2:3', '21:9']).optional().describe('Default: 9:16'),
  resolution: z.enum(['1K', '2K']).optional().describe('Default: 1K'),
  removeBg: z.boolean().optional().describe('Remove background after generation. Default: false'),
  seed: z.number().optional().describe('Seed for reproducibility'),
  name: z.string().optional().describe('Output filename without extension'),
});

export type GenerateAssetInput = z.infer<typeof generateAssetSchema>;

export async function generateAsset(input: GenerateAssetInput): Promise<any> {
  const aspectRatio = input.aspectRatio || '9:16';
  const resolution = input.resolution || '1K';
  const removeBg = input.removeBg || false;
  const name = input.name || `${input.type}_${Date.now()}`;

  try {
    // 1. Build prompt with type-specific prefix
    const prefixer = TYPE_PREFIXES[input.type];
    const fullPrompt = prefixer(input.prompt);

    // 2. Get session ID and prepare output directory
    const sessionState = getSessionState();
    const sessionId = sessionState?.sessionId ?? `session_${Date.now()}`;
    const outputDir = path.join(process.cwd(), 'data', 'assets', sessionId);
    mkdirSync(outputDir, { recursive: true });

    // 3. Call fal.ai T2I API
    console.log(`[generate-asset] Generating ${input.type}: "${input.prompt.slice(0, 50)}..."`);
    const apiInput: any = {
      prompt: fullPrompt,
      num_images: 1,
      aspect_ratio: aspectRatio,
      resolution: resolution,
      output_format: 'png',
    };

    if (input.seed !== undefined) {
      apiInput.seed = input.seed;
    }

    const result = await fal.subscribe('fal-ai/nano-banana-pro', {
      input: apiInput,
    }) as { data: { images: Array<{ url: string }> } };

    if (!result.data?.images?.[0]?.url) {
      throw new Error('No image URL in fal.ai response');
    }

    const generatedUrl = result.data.images[0].url;

    // 4. Download generated image
    const outputFilename = `${name}.png`;
    const outputPath = path.join(outputDir, outputFilename);
    await downloadImage(generatedUrl, outputPath);

    let finalPath = outputPath;
    let totalCost = 0.06; // Base cost for T2I API

    // 5. Optional background removal
    if (removeBg) {
      console.log(`[generate-asset] Removing background...`);
      const bgRemoveUrl = await uploadFile(outputPath);
      const bgResult = await fal.subscribe('fal-ai/bria/background/remove', {
        input: {
          image_url: bgRemoveUrl,
        },
      }) as { data: { image: { url: string } } };

      if (!bgResult.data?.image?.url) {
        throw new Error('No image URL in background removal response');
      }

      const nobgFilename = `${name}_nobg.png`;
      const nobgPath = path.join(outputDir, nobgFilename);
      await downloadImage(bgResult.data.image.url, nobgPath);
      finalPath = nobgPath;
      totalCost += 0.03; // Background removal cost
    }

    // 6. Get final image dimensions
    const dims = await getImageDimensions(readFileSync(finalPath));

    return {
      imagePath: finalPath,
      width: dims.width,
      height: dims.height,
      cost: totalCost,
      message: `Generated ${input.type}${removeBg ? ' (background removed)' : ''}: ${dims.width}x${dims.height}px at ${finalPath}`,
    };
  } catch (err: any) {
    console.error(`[generate-asset] Error:`, err);
    return {
      error: true,
      message: `Asset generation failed: ${err.message || String(err)}`,
    };
  }
}
