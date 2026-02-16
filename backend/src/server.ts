/**
 * Express + WebSocket server
 *
 * Handles:
 * - HTTP health check endpoint
 * - WebSocket connections from Figma plugin
 * - Message routing between plugin and agent
 * - Bridge creation per connection
 */

import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createBridge } from './bridge.js';
import { setupAgent, resetSession } from './agent.js';
import { setSessionState, getSessionState, getSessionId, clearSessionState } from './session-state.js';
import { addConceptSummary, type ConceptSummary } from './session-persistence.js';
import type { UserAction, PluginResponse } from '../../shared/protocol.js';
import { isPluginResponse, isUserAction } from '../../shared/protocol.js';
import { resetCostEstimated } from './hooks/pre-tool-use.js';

const PORT = parseInt(process.env.PORT || '3001', 10);

// Log environment configuration at startup
console.log('[Server] Environment:');
console.log(`  BRAND_DATA_ROOT: ${process.env.BRAND_DATA_ROOT || '(not set — using default)'}`);
console.log(`  AD_LIBRARY_ROOT: ${process.env.AD_LIBRARY_ROOT || '(not set — using default)'}`);
console.log(`  LEARNINGS_PATH: ${process.env.LEARNINGS_PATH || '(not set — using default)'}`);
console.log(`  FAL_KEY: ${process.env.FAL_KEY ? '***set***' : '(not set)'}`);

// API key is optional — if not set, the Agent SDK uses Claude Code's own auth
// (e.g., Max plan subscription via `claude login`)
if (!process.env.ANTHROPIC_API_KEY) {
  console.log('  ANTHROPIC_API_KEY: (not set — using Claude Code Max plan auth)');
}

// Express app
const app = express();

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// HTTP server
const server = createServer(app);

// WebSocket server
const wss = new WebSocketServer({ server });

wss.on('connection', async (socket: WebSocket) => {
  console.log('[Server] Plugin connected');

  // Create bridge for this connection
  const bridge = createBridge(socket);

  // Set up agent with default model (opus-4.6)
  let currentModel = 'claude-opus-4-6';

  try {
    await setupAgent({
      model: currentModel,
      bridge,
    });
  } catch (error) {
    console.error('[Server] Failed to set up agent:', error);
    socket.close();
    return;
  }

  // Handle incoming messages from plugin
  socket.on('message', (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString());

      // Route plugin responses to bridge
      if (isPluginResponse(message)) {
        bridge.handleResponse(message as PluginResponse);
        return;
      }

      // Route user actions
      if (isUserAction(message)) {
        const action = message as UserAction;

        // Handle model selection
        if (action.type === 'model_selected') {
          console.log('[Server] Model selected:', action.model);
          // Map UI model names to Claude model IDs
          const modelMap: Record<string, string> = {
            'opus-4.6': 'claude-opus-4-6',
            'opus-4.5': 'claude-opus-4-5-20250514',
            'sonnet-4.5': 'claude-sonnet-4-5-20250929',
          };
          currentModel = modelMap[action.model] || 'claude-opus-4-6';
          // Note: For Phase 1, model change takes effect on next agent setup
          // In future phases, we'll support dynamic model switching
          return;
        }

        // Handle brand selection
        if (action.type === 'brand_selected') {
          console.log('[Server] Brand selected:', action.brand, action.product);
          setSessionState(action.brand, action.product, currentModel);
          return;
        }

        // Handle new concept boundary
        if (action.type === 'new_concept') {
          console.log('[Server] New concept boundary triggered');

          // Build a concept summary from current state
          const sessionState = getSessionState();
          if (sessionState) {
            const summary: ConceptSummary = {
              angle: '', // TODO: extract from complete_concept calls
              formatCategory: '', // TODO: extract from complete_concept calls
              execution: '', // TODO: extract from complete_concept calls
              frameId: '', // TODO: extract from frame interactions
              keyDecisions: [],
              issues: [],
              cost: 0, // TODO: calculate from PostToolUse hook
              completedAt: new Date().toISOString(),
            };

            try {
              const sessionId = getSessionId();
              addConceptSummary(sessionId, summary);
            } catch (error) {
              console.error('[Server] Failed to save concept summary:', error);
            }
          }

          // Reset agent session (clears conversation history)
          resetSession();
          resetCostEstimated();
          return;
        }

        // Handle debug toggle
        if (action.type === 'debug_toggle') {
          console.log('[Server] Debug mode:', action.enabled ? 'enabled' : 'disabled');
          // Phase 1: just log it
          // Later phases will adjust logging/streaming
          return;
        }

        // Handle user messages
        if (action.type === 'user_message') {
          console.log('[Server] User message received, routing to agent');
          bridge.triggerUserMessage(action);
          return;
        }
      }

      console.warn('[Server] Unknown message type:', message);
    } catch (error) {
      console.error('[Server] Error handling message:', error);
    }
  });

  socket.on('close', () => {
    console.log('[Server] Plugin disconnected');
    bridge.close();
    // Session state persists to disk automatically via setSessionState
    // Clear in-memory state on disconnect
    clearSessionState();
  });

  socket.on('error', (error) => {
    console.error('[Server] WebSocket error:', error);
  });
});

// Start server
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[Server] Listening on http://127.0.0.1:${PORT}`);
  console.log(`[Server] WebSocket ready for plugin connections`);
});
