/**
 * Figma Plugin UI (ui.ts)
 *
 * Runs in the plugin UI iframe (browser context).
 * Has access to WebSocket/fetch, but NO figma.* API.
 *
 * Responsibilities:
 * - Connect to backend via WebSocket (ws://localhost:3001)
 * - Route backend commands → code.ts (via postMessage)
 * - Route code.ts responses → backend (via WebSocket)
 * - Render UIUpdate messages in chat interface
 * - Send user actions to backend
 * - Handle auto-reconnect with exponential backoff
 */

import { isPluginCommand, isPluginResponse, isUIUpdate } from '../../shared/protocol';
import type {
  PluginCommand,
  PluginResponse,
  UIUpdate,
  UserAction,
  NodeInfo,
} from '../../shared/protocol';

// ─── State ───

let ws: WebSocket | null = null;
let reconnectAttempt = 0;
let reconnectTimeout: number | null = null;
let currentSelection: NodeInfo[] = [];

const RECONNECT_DELAYS = [2000, 4000, 8000, 16000, 30000]; // ms, exponential backoff up to 30s
const WS_URL = 'ws://localhost:3001';

// ─── DOM Elements ───

const chatContainer = document.getElementById('chatContainer') as HTMLDivElement;
const userInput = document.getElementById('userInput') as HTMLTextAreaElement;
const sendButton = document.getElementById('sendButton') as HTMLButtonElement;
const statusDot = document.getElementById('statusDot') as HTMLDivElement;
const statusText = document.getElementById('statusText') as HTMLSpanElement;
const brandSelector = document.getElementById('brandSelector') as HTMLSelectElement;
const newConceptBtn = document.getElementById('newConceptBtn') as HTMLButtonElement;
const costDisplay = document.getElementById('costDisplay') as HTMLSpanElement;
const debugToggle = document.getElementById('debugToggle') as HTMLButtonElement;

let debugMode = false;

// ─── WebSocket Connection ───

function connect() {
  updateStatus('connecting');
  addStatusMessage('Connecting to backend...');

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    reconnectAttempt = 0; // reset backoff
    updateStatus('connected');
    addStatusMessage('Connected to backend');
    sendButton.disabled = false;
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);

      if (isPluginCommand(msg)) {
        // Backend → Plugin command: forward to code.ts
        parent.postMessage({ pluginMessage: msg }, '*');
      } else if (isUIUpdate(msg)) {
        // Backend → UI streaming update: render in chat
        handleUIUpdate(msg);
      } else {
        console.warn('Unknown message type from backend:', msg);
      }
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
    }
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    updateStatus('disconnected');
  };

  ws.onclose = () => {
    updateStatus('disconnected');
    addStatusMessage('Disconnected from backend');
    sendButton.disabled = true;
    ws = null;

    // Auto-reconnect with exponential backoff
    const delay = RECONNECT_DELAYS[Math.min(reconnectAttempt, RECONNECT_DELAYS.length - 1)];
    reconnectAttempt++;

    addStatusMessage(`Reconnecting in ${delay / 1000}s...`);

    reconnectTimeout = window.setTimeout(() => {
      connect();
    }, delay);
  };
}

// ─── Message Routing ───

// Listen for messages from code.ts (Figma main thread)
window.onmessage = (event) => {
  const msg = event.data.pluginMessage;
  if (!msg) return;

  if (isPluginResponse(msg)) {
    // Plugin → Backend response: forward via WebSocket
    if (msg.type === 'selection_changed') {
      // Update local selection state
      currentSelection = msg.nodes;
    }

    // Forward to backend
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  } else {
    console.warn('Unknown message from code.ts:', msg);
  }
};

// ─── UI Update Handlers ───

function handleUIUpdate(msg: UIUpdate) {
  switch (msg.type) {
    case 'agent_text':
      addAgentMessage(msg.content);
      break;
    case 'agent_thinking':
      addThinkingMessage(msg.content);
      break;
    case 'tool_start':
      addStatusMessage(`🔧 ${msg.tool}...`);
      break;
    case 'tool_result':
      addStatusMessage(`✓ ${msg.tool}: ${msg.summary}`);
      break;
    case 'cost_update':
      updateCostDisplay(msg.spent, msg.budget);
      break;
    case 'status':
      addStatusMessage(`[${msg.phase}] ${msg.message}`);
      break;
    case 'error_friendly':
      addErrorMessage(msg.message);
      break;
    case 'error_debug':
      addDebugMessage(msg.message, msg.raw);
      break;
  }
}

// ─── User Input Handlers ───

sendButton.addEventListener('click', sendUserMessage);
userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendUserMessage();
  }
});

brandSelector.addEventListener('change', () => {
  const value = brandSelector.value;
  if (!value || !ws || ws.readyState !== WebSocket.OPEN) return;

  const [brand, product] = value.split('/');
  const action: UserAction = {
    type: 'brand_selected',
    brand,
    product,
  };
  ws.send(JSON.stringify(action));
  addStatusMessage(`Brand set: ${brand} / ${product}`);
});

newConceptBtn.addEventListener('click', () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const action: UserAction = { type: 'new_concept' };
  ws.send(JSON.stringify(action));
  addStatusMessage('--- New Concept ---');
});

debugToggle.addEventListener('click', () => {
  debugMode = !debugMode;
  debugToggle.classList.toggle('active', debugMode);
  // Toggle visibility of existing debug messages
  document.querySelectorAll('.message.debug').forEach(el => {
    (el as HTMLElement).style.display = debugMode ? '' : 'none';
  });
  // Send to backend
  const action: UserAction = { type: 'debug_toggle', enabled: debugMode };
  ws?.send(JSON.stringify(action));
});

function sendUserMessage() {
  const content = userInput.value.trim();
  if (!content || !ws || ws.readyState !== WebSocket.OPEN) return;

  // Display user message in chat
  addUserMessage(content);

  // Send to backend with current selection
  const action: UserAction = {
    type: 'user_message',
    content,
    selection: currentSelection.length > 0 ? currentSelection : undefined,
  };

  ws.send(JSON.stringify(action));

  // Clear input
  userInput.value = '';
}

// ─── Chat Rendering ───

function addUserMessage(content: string) {
  const div = document.createElement('div');
  div.className = 'message user';
  div.textContent = content;
  chatContainer.appendChild(div);
  scrollToBottom();
}

function addAgentMessage(content: string) {
  const div = document.createElement('div');
  div.className = 'message agent';
  div.textContent = content;
  chatContainer.appendChild(div);
  scrollToBottom();
}

function addStatusMessage(content: string) {
  const div = document.createElement('div');
  div.className = 'message status';
  div.textContent = content;
  chatContainer.appendChild(div);
  scrollToBottom();
}

function addThinkingMessage(content: string) {
  const details = document.createElement('details');
  details.className = 'message thinking';

  const summary = document.createElement('summary');
  summary.textContent = 'Thinking...';
  summary.className = 'thinking-summary';

  const body = document.createElement('div');
  body.className = 'thinking-body';
  body.textContent = content;

  details.appendChild(summary);
  details.appendChild(body);
  chatContainer.appendChild(details);
  scrollToBottom();
}

function addErrorMessage(content: string) {
  const div = document.createElement('div');
  div.className = 'message status';
  div.style.color = '#ff6b6b';
  div.textContent = `❌ ${content}`;
  chatContainer.appendChild(div);
  scrollToBottom();
}

function addDebugMessage(message: string, raw: any) {
  const details = document.createElement('details');
  details.className = 'message thinking debug';
  if (!debugMode) details.style.display = 'none';

  const summary = document.createElement('summary');
  summary.textContent = `Debug: ${message}`;
  summary.className = 'thinking-summary';

  const body = document.createElement('div');
  body.className = 'thinking-body';
  body.textContent = JSON.stringify(raw, null, 2);

  details.appendChild(summary);
  details.appendChild(body);
  chatContainer.appendChild(details);
  scrollToBottom();
}

function updateCostDisplay(spent: number, budget: number) {
  costDisplay.textContent = `$${spent.toFixed(2)}`;
  costDisplay.title = `$${spent.toFixed(2)} of $${budget.toFixed(2)} budget`;
}

function scrollToBottom() {
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// ─── Status Bar ───

function updateStatus(status: 'connecting' | 'connected' | 'disconnected') {
  statusDot.className = 'status-dot';

  switch (status) {
    case 'connecting':
      statusDot.classList.add('connecting');
      statusText.textContent = 'Connecting...';
      break;
    case 'connected':
      statusDot.classList.add('connected');
      statusText.textContent = 'Connected';
      break;
    case 'disconnected':
      statusText.textContent = 'Disconnected';
      break;
  }
}

// ─── Init ───

connect();
