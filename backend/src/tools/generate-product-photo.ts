/**
 * generate_product_photo tool
 *
 * Uses fal.ai Nano Banana Pro Edit API to generate product photography
 * from reference images + scene prompt. Handles upload, generation,
 * optional background removal, and download.
 *
 * Pattern from terminal workflow: product-photography skill
 */

import { z } from 'zod';
import { mkdirSync, readFileSync } from 'fs';
import path from 'path';
import { uploadFile, downloadImage, fal } from '../fal-client.js';
import { getSessionState } from '../session-state.js';
import { getImageDimensions } from './image-analysis.js';

const REALISM_SUFFIX = `\n\nApply realism properties to the scene and product, such as: raw and detailed textures, realistic materials, skin pores, consistent lighting patterns, shadows, the laws of physics, and subtle signs of imperfection (wrinkles, bruises, micro-tears, etc.) Do not change, morph, or improvise the physical or brand details of the product in the second image. Do not defy the laws of physics where realism is implied.`;

export const generateProductPhotoSchema = z.object({
  prompt: z.string().describe('Scene description for the product photo'),
  referenceImages: z.array(z.string()).min(1).max(12).describe('Absolute paths to product reference images'),
  aspectRatio: z.enum(['9:16', '1:1', '16:9', '4:3', '3:4', '4:5', '5:4', '3:2', '2:3', '21:9']).optional().describe('Default: 9:16'),
  resolution: z.enum(['1K', '2K']).optional().describe('Default: 2K'),
  removeBg: z.boolean().optional().describe('Remove background after generation. Default: false'),
  name: z.string().optional().describe('Output filename without extension'),
});

export type GenerateProductPhotoInput = z.infer<typeof generateProductPhotoSchema>;

export async function generateProductPhoto(input: GenerateProductPhotoInput): Promise<any> {
  const aspectRatio = input.aspectRatio || '9:16';
  const resolution = input.resolution || '2K';
  const removeBg = input.removeBg || false;
  const name = input.name || `product_${Date.now()}`;

  try {
    // 1. Get session ID and prepare output directory
    const sessionState = getSessionState();
    const sessionId = sessionState?.sessionId ?? `session_${Date.now()}`;
    const outputDir = path.join(process.cwd(), 'data', 'assets', sessionId);
    mkdirSync(outputDir, { recursive: true });

    // 2. Upload all reference images (parallelize)
    console.log(`[generate-product-photo] Uploading ${input.referenceImages.length} reference images...`);
    const imageUrls = await Promise.all(
      input.referenceImages.map((imgPath) => uploadFile(imgPath))
    );

    // 3. Append realism suffix to prompt
    const fullPrompt = input.prompt + REALISM_SUFFIX;

    // 4. Call fal.ai Edit API
    console.log(`[generate-product-photo] Generating product photo: "${input.prompt.slice(0, 60)}..."`);
    const result = await fal.subscribe('fal-ai/nano-banana-pro/edit', {
      input: {
        prompt: fullPrompt,
        image_urls: imageUrls,
        aspect_ratio: aspectRatio,
        resolution: resolution,
        num_images: 1,
        output_format: 'png',
      },
    }) as { data: { images: Array<{ url: string }> } };

    if (!result.data?.images?.[0]?.url) {
      throw new Error('No image URL in fal.ai response');
    }

    const generatedUrl = result.data.images[0].url;

    // 5. Download generated image
    const outputFilename = `${name}.png`;
    const outputPath = path.join(outputDir, outputFilename);
    await downloadImage(generatedUrl, outputPath);

    let finalPath = outputPath;
    let totalCost = 0.12; // Base cost for Edit API

    // 6. Optional background removal
    if (removeBg) {
      console.log(`[generate-product-photo] Removing background...`);
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

    // 7. Get final image dimensions
    const dims = await getImageDimensions(readFileSync(finalPath));

    return {
      imagePath: finalPath,
      width: dims.width,
      height: dims.height,
      cost: totalCost,
      message: `Generated product photo${removeBg ? ' (background removed)' : ''}: ${dims.width}x${dims.height}px at ${finalPath}`,
    };
  } catch (err: any) {
    console.error(`[generate-product-photo] Error:`, err);
    return {
      error: true,
      message: `Product photo generation failed: ${err.message || String(err)}`,
    };
  }
}
