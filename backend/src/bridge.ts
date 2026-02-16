/**
 * Bridge module — WebSocket command/response correlation
 *
 * THE critical piece. Handles:
 * - Sending commands to plugin with UUID correlation
 * - Promise-based response handling
 * - 30s timeout per command
 * - Pending request tracking
 * - UI update streaming
 * - User message handling
 */

import { WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import type { PluginCommand, PluginResponse, UIUpdate, UserAction } from '../../shared/protocol.js';

const COMMAND_TIMEOUT_MS = 30000; // 30 seconds

interface PendingCommand {
  resolve: (data: any) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface Bridge {
  /**
   * Send a command to the plugin and wait for response
   * Returns a Promise that resolves with the response data or rejects with an error
   */
  sendCommand(command:
    | { type: 'figma_call'; method: string; args: any[] }
    | { type: 'export_node'; nodeId: string; format: 'PNG' | 'SVG' | 'JPG'; scale: number }
    | { type: 'get_state' }
    | { type: 'serialize_frame'; frameId: string }
    | { type: 'restore_checkpoint'; frameId: string; serialized: any }
    | { type: 'get_selection' }
    | { type: 'image_data'; base64: string; targetNodeId: string; scaleMode: 'FILL' | 'FIT' | 'CROP' | 'TILE' }
    | { type: 'batch_update'; updates: Array<{ nodeId: string; properties: any }> }
    | { type: 'batch_operations'; operations: Array<{
        op: string; variable?: string; parent?: string | null; nodeId?: string;
        props?: Record<string, any>; fontFamily?: string; fontStyle?: string;
        base64?: string; scaleMode?: string; newParent?: string; index?: number;
      }> }
  ): Promise<any>;

  /**
   * Handle a response from the plugin
   * Matches by id and resolves/rejects the corresponding pending promise
   */
  handleResponse(response: PluginResponse): void;

  /**
   * Send a UI update to the plugin (no response expected)
   * Used for streaming agent output, tool usage, etc.
   */
  sendUIUpdate(update: UIUpdate): void;

  /**
   * Register a callback for user messages from the plugin
   */
  onUserMessage(handler: (action: UserAction) => void): void;

  /**
   * Trigger the registered user message handler
   * Called by server.ts when a user_message action arrives
   */
  triggerUserMessage(action: UserAction): void;

  /**
   * Check if the WebSocket is still connected
   */
  isConnected(): boolean;

  /**
   * Clean up pending requests and close the connection
   */
  close(): void;
}

export function createBridge(socket: WebSocket): Bridge {
  const pending = new Map<string, PendingCommand>();
  let userMessageHandler: ((action: UserAction) => void) | null = null;

  // Clean up on socket close
  socket.on('close', () => {
    for (const [id, pendingCmd] of pending.entries()) {
      clearTimeout(pendingCmd.timer);
      pendingCmd.reject(new Error('WebSocket connection closed'));
    }
    pending.clear();
  });

  return {
    sendCommand(command: Parameters<Bridge['sendCommand']>[0]): Promise<any> {
      if (socket.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error('WebSocket not connected'));
      }

      const id = uuidv4();
      const fullCommand = { ...command, id } as PluginCommand;

      return new Promise((resolve, reject) => {
        // Set up timeout
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Command timeout after ${COMMAND_TIMEOUT_MS}ms: ${command.type}`));
        }, COMMAND_TIMEOUT_MS);

        // Store pending promise
        pending.set(id, { resolve, reject, timer });

        // Send command
        try {
          socket.send(JSON.stringify(fullCommand));
        } catch (error) {
          clearTimeout(timer);
          pending.delete(id);
          reject(error);
        }
      });
    },

    handleResponse(response: PluginResponse): void {
      if (response.type === 'result' || response.type === 'error') {
        const pendingCmd = pending.get(response.id);
        if (!pendingCmd) {
          console.warn(`[Bridge] No pending command for response id: ${response.id}`);
          return;
        }

        clearTimeout(pendingCmd.timer);
        pending.delete(response.id);

        if (response.type === 'result') {
          pendingCmd.resolve(response.data);
        } else {
          pendingCmd.reject(new Error(response.error));
        }
      }
      // selection_changed and page_changed are not correlated to specific commands
      // They're just notifications — ignore for now in Phase 1
    },

    sendUIUpdate(update: UIUpdate): void {
      if (socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(JSON.stringify(update));
        } catch (error) {
          console.error('[Bridge] Failed to send UI update:', error);
        }
      }
    },

    onUserMessage(handler: (action: UserAction) => void): void {
      userMessageHandler = handler;
    },

    triggerUserMessage(action: UserAction): void {
      if (userMessageHandler) {
        userMessageHandler(action);
      } else {
        console.warn('[Bridge] No user message handler registered');
      }
    },

    isConnected(): boolean {
      return socket.readyState === WebSocket.OPEN;
    },

    close(): void {
      // Clean up all pending
      for (const [id, pendingCmd] of pending.entries()) {
        clearTimeout(pendingCmd.timer);
        pendingCmd.reject(new Error('Bridge closed'));
      }
      pending.clear();

      // Close socket
      if (socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
    },
  };

  // Note: actual user message routing happens in server.ts
  // This is just the registration mechanism
}
