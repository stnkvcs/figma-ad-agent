/**
 * Session state management
 *
 * Tracks current brand/product selection and concept summaries.
 * Set on brand_selected events, read by tools that need context.
 *
 * Phase 3a: module-level state (in-memory)
 * Phase 3b: file-backed persistence for session resume
 */

import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import {
  saveSession,
  loadSession,
  listSessions,
  updateSessionCost,
  type ConceptSummary,
  type PersistedSession,
} from './session-persistence.js';

export interface SessionState {
  sessionId: string;
  brand: string;
  product: string;
  model: string;
  conceptSummaries: ConceptSummary[];
  totalCost: number;
}

let currentState: SessionState | null = null;

/**
 * Initialize or update session state when brand is selected.
 * Creates a new session ID and persists to disk.
 */
export function setSessionState(brand: string, product: string, model: string): void {
  const sessionId = uuidv4();

  currentState = {
    sessionId,
    brand,
    product,
    model,
    conceptSummaries: [],
    totalCost: 0,
  };

  // Persist to disk
  const persistedSession: PersistedSession = {
    sessionId,
    brand,
    product,
    model,
    conceptSummaries: [],
    assetManifest: [],
    totalCost: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  saveSession(persistedSession);

  // Ensure asset output directory exists
  const assetDir = path.join(process.cwd(), 'data', 'assets', sessionId);
  fs.mkdirSync(assetDir, { recursive: true });

  console.log(`[Session] State set: sessionId=${sessionId}, brand=${brand}, product=${product}, model=${model}`);
}

/**
 * Get the current session state.
 * Returns null if no brand has been selected yet.
 *
 * On server restart, attempts to load the most recent session.
 */
export function getSessionState(): SessionState | null {
  // If in-memory state exists, return it
  if (currentState) {
    return currentState;
  }

  // Otherwise, try to load the most recent session
  const sessions = listSessions();
  if (sessions.length === 0) {
    return null;
  }

  // Sort by updatedAt descending
  sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const mostRecent = sessions[0];

  const persisted = loadSession(mostRecent.sessionId);
  if (!persisted) {
    return null;
  }

  // Restore in-memory state
  currentState = {
    sessionId: persisted.sessionId,
    brand: persisted.brand,
    product: persisted.product,
    model: persisted.model,
    conceptSummaries: persisted.conceptSummaries,
    totalCost: persisted.totalCost,
  };

  console.log(`[Session] Restored session ${persisted.sessionId} from disk`);
  return currentState;
}

/**
 * Get current brand name. Throws if no brand selected.
 */
export function getCurrentBrand(): string {
  if (!currentState) {
    throw new Error('No brand selected. Select a brand first.');
  }
  return currentState.brand;
}

/**
 * Get current product name. Throws if no brand selected.
 */
export function getCurrentProduct(): string {
  if (!currentState) {
    throw new Error('No brand selected. Select a brand first.');
  }
  return currentState.product;
}

/**
 * Clear session state (e.g., on disconnect).
 */
export function clearSessionState(): void {
  currentState = null;
  console.log('[Session] State cleared');
}

/**
 * Get the current session ID.
 * Throws if no session is active.
 */
export function getSessionId(): string {
  if (!currentState) {
    throw new Error('No session active. Select a brand first.');
  }
  return currentState.sessionId;
}

/**
 * Get the asset output directory for the current session.
 * Returns: data/assets/{sessionId}/
 */
export function getAssetOutputDir(): string {
  const sessionId = getSessionId();
  return path.join(process.cwd(), 'data', 'assets', sessionId);
}

/**
 * Add cost to the current session.
 * Updates both in-memory state and persisted session.
 */
export function addSessionCost(amount: number): void {
  if (!currentState) {
    throw new Error('No session active. Cannot add cost.');
  }

  currentState.totalCost += amount;
  updateSessionCost(currentState.sessionId, amount);
}
