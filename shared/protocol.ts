/**
 * WebSocket protocol definitions for Figma Plugin Agent
 *
 * These types define all messages exchanged between:
 * - Backend → Plugin (commands)
 * - Plugin → Backend (responses)
 * - Backend → Plugin UI (streaming updates)
 * - Plugin → Backend (user actions)
 */

import { NodeInfo, SerializedNode } from './types.js';

// ─── Backend → Plugin (commands) ───

/**
 * Commands sent from backend to plugin to execute Figma API operations
 */
export type PluginCommand =
  | {
      type: 'figma_call';
      id: string;
      method: string;
      args: any[];
    }
  | {
      type: 'export_node';
      id: string;
      nodeId: string;
      format: 'PNG' | 'SVG' | 'JPG';
      scale: number;
    }
  | {
      type: 'get_state';
      id: string;
    }
  | {
      type: 'serialize_frame';
      id: string;
      frameId: string;
    }
  | {
      type: 'restore_checkpoint';
      id: string;
      frameId: string;
      serialized: SerializedNode;
    }
  | {
      type: 'get_selection';
      id: string;
    }
  | {
      type: 'image_data';
      id: string;
      base64: string;
      targetNodeId: string;
      scaleMode: 'FILL' | 'FIT' | 'CROP' | 'TILE';
    }
  | {
      type: 'batch_update';
      id: string;
      updates: Array<{
        nodeId: string;
        properties: any;
      }>;
    }
  | {
      type: 'batch_operations';
      id: string;
      operations: Array<{
        op: string;
        variable?: string;
        parent?: string | null;
        nodeId?: string;
        props?: Record<string, any>;
        fontFamily?: string;
        fontStyle?: string;
        base64?: string;
        scaleMode?: string;
        newParent?: string;
        index?: number;
      }>;
    };

// ─── Plugin → Backend (responses) ───

/**
 * Responses sent from plugin to backend after executing commands
 */
export type PluginResponse =
  | {
      type: 'result';
      id: string;
      data: any;
    }
  | {
      type: 'error';
      id: string;
      error: string;
    }
  | {
      type: 'selection_changed';
      nodes: NodeInfo[];
    }
  | {
      type: 'page_changed';
      pageId: string;
    };

// ─── Backend → Plugin (streaming UI updates) ───

/**
 * Streaming updates from backend to plugin UI
 * These render in the chat interface
 */
export type UIUpdate =
  | {
      type: 'agent_text';
      content: string;
    }
  | {
      type: 'agent_thinking';
      content: string; // collapsible in UI
    }
  | {
      type: 'tool_start';
      tool: string;
      input: any;
    }
  | {
      type: 'tool_result';
      tool: string;
      summary: string;
    }
  | {
      type: 'cost_update';
      spent: number;
      budget: number;
    }
  | {
      type: 'status';
      phase: string;
      message: string;
    }
  | {
      type: 'error_friendly';
      message: string; // user-facing
    }
  | {
      type: 'error_debug';
      message: string;
      raw: any; // debug toggle
    };

// ─── Plugin → Backend (user actions) ───

/**
 * User actions sent from plugin UI to backend
 */
export type UserAction =
  | {
      type: 'user_message';
      content: string;
      selection?: NodeInfo[];
    }
  | {
      type: 'brand_selected';
      brand: string;
      product: string;
    }
  | {
      type: 'new_concept'; // concept boundary trigger
    }
  | {
      type: 'model_selected';
      model: 'opus-4.6' | 'opus-4.5' | 'sonnet-4.5';
    }
  | {
      type: 'debug_toggle';
      enabled: boolean;
    };

// ─── Exports for convenience ───

/**
 * Union of all message types that can be sent over WebSocket
 */
export type WebSocketMessage = PluginCommand | PluginResponse | UIUpdate | UserAction;

/**
 * Type guard to check if a message is a PluginCommand
 */
export function isPluginCommand(msg: any): msg is PluginCommand {
  return (
    msg &&
    typeof msg === 'object' &&
    'type' in msg &&
    [
      'figma_call',
      'export_node',
      'get_state',
      'serialize_frame',
      'restore_checkpoint',
      'get_selection',
      'image_data',
      'batch_update',
      'batch_operations',
    ].includes(msg.type)
  );
}

/**
 * Type guard to check if a message is a PluginResponse
 */
export function isPluginResponse(msg: any): msg is PluginResponse {
  return (
    msg &&
    typeof msg === 'object' &&
    'type' in msg &&
    ['result', 'error', 'selection_changed', 'page_changed'].includes(msg.type)
  );
}

/**
 * Type guard to check if a message is a UIUpdate
 */
export function isUIUpdate(msg: any): msg is UIUpdate {
  return (
    msg &&
    typeof msg === 'object' &&
    'type' in msg &&
    [
      'agent_text',
      'agent_thinking',
      'tool_start',
      'tool_result',
      'cost_update',
      'status',
      'error_friendly',
      'error_debug',
    ].includes(msg.type)
  );
}

/**
 * Type guard to check if a message is a UserAction
 */
export function isUserAction(msg: any): msg is UserAction {
  return (
    msg &&
    typeof msg === 'object' &&
    'type' in msg &&
    ['user_message', 'brand_selected', 'new_concept', 'model_selected', 'debug_toggle'].includes(
      msg.type
    )
  );
}

// Re-export domain types for convenience
export type { NodeInfo, SerializedNode, SerializedPaint, SerializedEffect, CanvasState } from './types.js';
