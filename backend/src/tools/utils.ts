/**
 * Shared utilities for tools
 *
 * Common helpers used across multiple tool implementations.
 * Avoids duplication and provides consistent behavior.
 */

import { readFileSync } from 'fs';

/**
 * Convert hex color to Figma RGB object (values 0-1)
 * Supports 3, 6, or 8 character hex (with or without #)
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const cleanHex = hex.replace(/^#/, '');

  let r: number, g: number, b: number;

  if (cleanHex.length === 3) {
    r = parseInt(cleanHex[0] + cleanHex[0], 16) / 255;
    g = parseInt(cleanHex[1] + cleanHex[1], 16) / 255;
    b = parseInt(cleanHex[2] + cleanHex[2], 16) / 255;
  } else {
    r = parseInt(cleanHex.substring(0, 2), 16) / 255;
    g = parseInt(cleanHex.substring(2, 4), 16) / 255;
    b = parseInt(cleanHex.substring(4, 6), 16) / 255;
  }

  return { r, g, b };
}

/**
 * Convert hex color to Figma RGBA object (values 0-1)
 * Supports 6 or 8 character hex (with or without #)
 * 8-char hex: last 2 chars are alpha (e.g., #0000001A = black at ~10% opacity)
 */
export function hexToRgba(hex: string): { r: number; g: number; b: number; a: number } {
  const cleanHex = hex.replace(/^#/, '');

  const rgb = hexToRgb(hex);

  let a = 1;
  if (cleanHex.length === 8) {
    a = parseInt(cleanHex.substring(6, 8), 16) / 255;
  }

  return { ...rgb, a };
}

/**
 * Convert font weight number to Figma style string
 */
export function weightToStyle(weight: number): string {
  if (weight <= 200) return 'Ultralight';
  if (weight <= 300) return 'Light';
  if (weight <= 400) return 'Regular';
  if (weight <= 500) return 'Medium';
  if (weight <= 600) return 'SemiBold';
  if (weight <= 700) return 'Bold';
  return 'Black';
}

/**
 * Read a file from disk and return as base64 string
 */
export function readFileAsBase64(absolutePath: string): string {
  const buffer = readFileSync(absolutePath);
  return buffer.toString('base64');
}

/**
 * Snap a number to the nearest 8px grid value
 */
export function snap8(value: number): number {
  return Math.round(value / 8) * 8;
}

/**
 * Convert a rotation angle (degrees) to Figma's gradient transform matrix.
 *
 * Figma uses a 2x3 affine transform matrix: [[a, c, tx], [b, d, ty]]
 * For a linear gradient, this defines the start and end points.
 *
 * 0° = left to right, 90° = top to bottom, 180° = right to left, etc.
 * Default (180°) = top to bottom (most common for ad backgrounds).
 */
export function rotationToGradientTransform(
  degrees: number = 180,
): [[number, number, number], [number, number, number]] {
  const radians = (degrees * Math.PI) / 180;

  // Figma gradient transform is relative to 0-1 coordinate space
  // The transform maps from gradient space to node space
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  // Center the gradient at (0.5, 0.5) and apply rotation
  const tx = 0.5 + 0.5 * cos - 0.5 * sin;
  const ty = 0.5 + 0.5 * sin + 0.5 * cos;

  return [
    [cos, sin, tx],
    [-sin, cos, ty],
  ];
}
