/**
 * remove_background tool
 *
 * Uses fal.ai BRIA background removal API to remove backgrounds from images.
 * Saves the result in the same directory with a _nobg suffix.
 *
 * Pattern from terminal workflow: image-manipulation skill (background removal)
 */

import { z } from 'zod';
import path from 'path';
import { uploadFile, downloadImage, fal } from '../fal-client.js';

export const removeBackgroundSchema = z.object({
  imagePath: z.string().describe('Absolute path to image file'),
});

export type RemoveBackgroundInput = z.infer<typeof removeBackgroundSchema>;

export async function removeBackground(input: RemoveBackgroundInput): Promise<any> {
  try {
    // 1. Upload image to fal storage
    console.log(`[remove-background] Uploading image: ${path.basename(input.imagePath)}`);
    const imageUrl = await uploadFile(input.imagePath);

    // 2. Call background removal API
    console.log(`[remove-background] Removing background...`);
    const result = await fal.subscribe('fal-ai/bria/background/remove', {
      input: {
        image_url: imageUrl,
      },
    }) as { data: { image: { url: string } } };

    if (!result.data?.image?.url) {
      throw new Error('No image URL in background removal response');
    }

    // 3. Download result to same directory with _nobg suffix
    const parsedPath = path.parse(input.imagePath);
    const outputFilename = `${parsedPath.name}_nobg${parsedPath.ext}`;
    const outputPath = path.join(parsedPath.dir, outputFilename);

    await downloadImage(result.data.image.url, outputPath);

    return {
      imagePath: outputPath,
      cost: 0.03,
      message: `Background removed: ${outputPath}`,
    };
  } catch (err: any) {
    console.error(`[remove-background] Error:`, err);
    return {
      error: true,
      message: `Background removal failed: ${err.message || String(err)}`,
    };
  }
}
