/**
 * fal.ai client singleton and upload/download helpers
 *
 * Provides configured fal client + utilities for uploading reference images
 * and downloading generated results. Caches uploads to avoid redundant transfers.
 */

import { fal } from '@fal-ai/client';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';

// Configure fal client with API key from env (lazy — warns on startup if missing)
const FAL_KEY = process.env.FAL_KEY;
if (FAL_KEY) {
  fal.config({ credentials: FAL_KEY });
} else {
  console.warn('[fal-client] FAL_KEY not set — asset generation tools will fail. Set FAL_KEY in .env');
}

/** Throws if FAL_KEY is not configured. Call before any fal.ai API operation. */
function ensureConfigured(): void {
  if (!FAL_KEY) {
    throw new Error('FAL_KEY environment variable is not set. Add it to backend/.env');
  }
}

// Upload cache: absolute path → fal URL
const uploadCache = new Map<string, string>();

/**
 * Upload a file to fal.ai storage and return the fal URL.
 * Uses cache to avoid re-uploading the same file.
 */
export async function uploadFile(absolutePath: string): Promise<string> {
  ensureConfigured();

  // Check cache first
  const cached = uploadCache.get(absolutePath);
  if (cached) {
    console.log(`[fal-client] Using cached upload: ${path.basename(absolutePath)} → ${cached}`);
    return cached;
  }

  // Determine content type from extension
  const ext = path.extname(absolutePath).toLowerCase();
  const contentTypeMap: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
  };
  const contentType = contentTypeMap[ext] || 'image/png';

  // Read file into buffer
  const buffer = readFileSync(absolutePath);

  // Try SDK upload first
  try {
    const blob = new Blob([buffer], { type: contentType });
    const url = await fal.storage.upload(blob);
    uploadCache.set(absolutePath, url);
    console.log(`[fal-client] Uploaded via SDK: ${path.basename(absolutePath)} → ${url}`);
    return url;
  } catch (sdkError) {
    console.warn(`[fal-client] SDK upload failed, falling back to raw HTTP:`, sdkError);

    // Fallback: raw HTTP upload
    const FAL_UPLOAD_URL = 'https://rest.alpha.fal.ai/storage/upload/initiate';

    // Step 1: Initiate upload
    const initResponse = await fetch(FAL_UPLOAD_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${FAL_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        file_name: path.basename(absolutePath),
        content_type: contentType,
      }),
    });

    if (!initResponse.ok) {
      throw new Error(`Upload init failed: ${initResponse.status} ${initResponse.statusText}`);
    }

    const initData = await initResponse.json() as { upload_url: string; file_url: string };

    // Step 2: PUT file bytes to upload_url
    const uploadResponse = await fetch(initData.upload_url, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: buffer,
    });

    if (!uploadResponse.ok) {
      throw new Error(`Upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`);
    }

    // Step 3: Cache and return file_url
    uploadCache.set(absolutePath, initData.file_url);
    console.log(`[fal-client] Uploaded via HTTP: ${path.basename(absolutePath)} → ${initData.file_url}`);
    return initData.file_url;
  }
}

/**
 * Download an image from a URL and save it to outputPath.
 * Returns the absolute path of the saved file.
 */
export async function downloadImage(url: string, outputPath: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  writeFileSync(outputPath, buffer);
  console.log(`[fal-client] Downloaded: ${url} → ${path.basename(outputPath)}`);
  return outputPath;
}

// Export configured fal instance for direct API calls
export { fal };
