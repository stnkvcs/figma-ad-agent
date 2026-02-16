/**
 * File-backed session persistence
 *
 * Stores session state to disk for:
 * - Session resume across plugin restarts
 * - Concept history tracking (multi-concept sessions)
 * - Asset manifest logging
 * - Cost accumulation
 *
 * Storage: backend/data/sessions/{sessionId}.json
 */

import fs from 'fs';
import path from 'path';

const SESSIONS_DIR = path.join(process.cwd(), 'data', 'sessions');

export interface PersistedSession {
  sessionId: string;
  brand: string;
  product: string;
  model: string;
  conceptSummaries: ConceptSummary[];
  assetManifest: AssetEntry[];
  totalCost: number;
  createdAt: string;
  updatedAt: string;
}

export interface ConceptSummary {
  angle: string;
  formatCategory: string;
  execution: string;
  frameId: string;
  keyDecisions: string[];
  issues: string[];
  cost: number;
  completedAt: string;
}

export interface AssetEntry {
  taskId: string;
  type: 'product_photo' | 'asset' | 'bg_removed';
  path: string;
  prompt: string;
  cost: number;
  createdAt: string;
}

/**
 * Ensure the sessions directory exists
 */
function ensureSessionsDir(): void {
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

/**
 * Get the file path for a session
 */
function getSessionPath(sessionId: string): string {
  return path.join(SESSIONS_DIR, `${sessionId}.json`);
}

/**
 * Save a session to disk
 */
export function saveSession(session: PersistedSession): void {
  ensureSessionsDir();
  const filePath = getSessionPath(session.sessionId);

  // Update timestamp
  const updated = {
    ...session,
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(filePath, JSON.stringify(updated, null, 2), 'utf-8');
  console.log(`[Persistence] Saved session ${session.sessionId}`);
}

/**
 * Load a session from disk
 * Returns null if session doesn't exist
 */
export function loadSession(sessionId: string): PersistedSession | null {
  const filePath = getSessionPath(sessionId);

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * List all sessions (metadata only)
 */
export function listSessions(): Array<{
  sessionId: string;
  brand: string;
  product: string;
  updatedAt: string;
}> {
  ensureSessionsDir();

  try {
    const files = fs.readdirSync(SESSIONS_DIR);
    return files
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const sessionId = f.replace('.json', '');
        const session = loadSession(sessionId);
        if (!session) return null;

        return {
          sessionId: session.sessionId,
          brand: session.brand,
          product: session.product,
          updatedAt: session.updatedAt,
        };
      })
      .filter(Boolean) as Array<{
        sessionId: string;
        brand: string;
        product: string;
        updatedAt: string;
      }>;
  } catch {
    return [];
  }
}

/**
 * Delete a session file
 */
export function deleteSession(sessionId: string): void {
  const filePath = getSessionPath(sessionId);

  try {
    fs.unlinkSync(filePath);
    console.log(`[Persistence] Deleted session ${sessionId}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

/**
 * Add a concept summary to a session
 */
export function addConceptSummary(sessionId: string, summary: ConceptSummary): void {
  const session = loadSession(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  session.conceptSummaries.push(summary);
  saveSession(session);
  console.log(`[Persistence] Added concept summary to session ${sessionId}`);
}

/**
 * Add an asset entry to a session
 */
export function addAssetEntry(sessionId: string, entry: AssetEntry): void {
  const session = loadSession(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  session.assetManifest.push(entry);
  saveSession(session);
  console.log(`[Persistence] Added asset entry to session ${sessionId}`);
}

/**
 * Update total cost for a session
 */
export function updateSessionCost(sessionId: string, additionalCost: number): void {
  const session = loadSession(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  session.totalCost += additionalCost;
  saveSession(session);
  console.log(`[Persistence] Updated session ${sessionId} cost: +$${additionalCost.toFixed(4)} = $${session.totalCost.toFixed(4)}`);
}
