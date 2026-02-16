/**
 * Image analysis utilities
 *
 * Uses sharp for server-side image processing: trimming transparent pixels,
 * reading dimensions, etc. These are helpers consumed by other tools
 * (e.g., place-product), not standalone agent tools.
 */

import sharp from 'sharp';

export interface TrimResult {
  trimmedBuffer: Buffer;
  originalWidth: number;
  originalHeight: number;
  trimmedWidth: number;
  trimmedHeight: number;
}

/**
 * Trim transparent pixels from the edges of an image.
 * Used to remove invisible padding from background-removed product cutouts
 * so that image bounds match visible content.
 */
export async function trimTransparentPixels(imageBuffer: Buffer): Promise<TrimResult> {
  const metadata = await sharp(imageBuffer).metadata();
  const trimResult = await sharp(imageBuffer)
    .trim() // removes transparent borders
    .toBuffer({ resolveWithObject: true });

  return {
    trimmedBuffer: trimResult.data,
    originalWidth: metadata.width || 0,
    originalHeight: metadata.height || 0,
    trimmedWidth: trimResult.info.width,
    trimmedHeight: trimResult.info.height,
  };
}

/**
 * Get the dimensions of an image buffer.
 */
export async function getImageDimensions(imageBuffer: Buffer): Promise<{ width: number; height: number }> {
  const metadata = await sharp(imageBuffer).metadata();
  return { width: metadata.width || 0, height: metadata.height || 0 };
}
