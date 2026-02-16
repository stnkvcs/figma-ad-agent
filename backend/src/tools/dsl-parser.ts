/**
 * DSL Parser for batch_operations
 *
 * Parses a line-by-line DSL into structured operations for the Figma plugin.
 * Variable refs ($name) stay as strings — the plugin resolves them at execution time.
 *
 * Grammar:
 *   // Comment
 *   varName=OP(parentRef, { prop: value, ... })   // CREATE ops
 *   OP(nodeRef, { prop: value, ... })              // Mutation ops
 *   OP(nodeRef)                                     // Simple ops (TRIM, DELETE)
 *   REPARENT(nodeRef, newParentRef, index?)         // Reparent
 *
 * References: $varName → node ID from earlier CREATE. "nodeId" → literal ID. null → current page.
 */

export type ParsedOperation = {
  op: string;
  variable?: string;
  parent?: string | null;
  nodeId?: string;
  props?: Record<string, any>;
  // Text-specific (extracted from props for font loading in plugin)
  fontFamily?: string;
  fontStyle?: string;
  // SET_IMAGE_FILL-specific (populated by backend handler, not DSL)
  base64?: string;
  scaleMode?: string;
  // REPARENT-specific
  newParent?: string;
  index?: number;
};

const CREATE_OPS = new Set(['CREATE_FRAME', 'CREATE_TEXT', 'CREATE_RECT']);
const MUTATION_OPS = new Set(['SET_IMAGE_FILL', 'UPDATE', 'SET_GRADIENT', 'ADD_EFFECT']);
const SIMPLE_OPS = new Set(['TRIM', 'DELETE']);
const ALL_OPS = new Set([...CREATE_OPS, ...MUTATION_OPS, ...SIMPLE_OPS, 'REPARENT']);

/**
 * Parse a DSL script into an array of operations.
 * Each line is one operation. Empty lines and comments (//) are skipped.
 */
export function parseDSL(dsl: string): ParsedOperation[] {
  const lines = dsl.split('\n');
  const operations: ParsedOperation[] = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line || line.startsWith('//')) continue;

    // Strip inline comments (only outside strings)
    line = stripInlineComment(line);
    if (!line) continue;

    operations.push(parseLine(line, i + 1));
  }

  return operations;
}

/**
 * Strip inline comments that aren't inside string literals.
 */
function stripInlineComment(line: string): string {
  let inString = false;
  let stringChar = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inString) {
      if (ch === stringChar && line[i - 1] !== '\\') inString = false;
    } else {
      if (ch === '"' || ch === "'") {
        inString = true;
        stringChar = ch;
      } else if (ch === '/' && line[i + 1] === '/') {
        return line.substring(0, i).trim();
      }
    }
  }
  return line;
}

/**
 * Parse a single DSL line into a ParsedOperation.
 */
function parseLine(line: string, lineNumber: number): ParsedOperation {
  // Check for variable assignment: var=OP(...)
  let variable: string | undefined;
  let rest = line;

  const firstParen = line.indexOf('(');
  const firstEq = line.indexOf('=');

  // Only treat as assignment if = comes before (
  if (firstEq > 0 && (firstParen === -1 || firstEq < firstParen)) {
    variable = line.substring(0, firstEq).trim();
    rest = line.substring(firstEq + 1).trim();
  }

  // Extract OP name
  const openParen = rest.indexOf('(');
  if (openParen === -1) {
    throw new Error(`Line ${lineNumber}: Missing opening parenthesis: ${line}`);
  }

  const op = rest.substring(0, openParen).trim();
  if (!ALL_OPS.has(op)) {
    throw new Error(`Line ${lineNumber}: Unknown operation "${op}". Valid: ${[...ALL_OPS].join(', ')}`);
  }

  // Find matching closing paren (respecting nested braces and strings)
  const closeParen = findMatchingParen(rest, openParen);
  if (closeParen === -1) {
    throw new Error(`Line ${lineNumber}: Unmatched parenthesis: ${line}`);
  }

  const argsContent = rest.substring(openParen + 1, closeParen).trim();

  // Route to specific parser
  if (CREATE_OPS.has(op)) {
    if (!variable) {
      throw new Error(`Line ${lineNumber}: CREATE operations must assign to a variable: varName=${op}(...)`);
    }
    return parseCreateOp(op, variable, argsContent, lineNumber);
  } else if (op === 'REPARENT') {
    return parseReparentOp(argsContent, lineNumber);
  } else if (SIMPLE_OPS.has(op)) {
    return parseSimpleOp(op, argsContent, lineNumber);
  } else {
    return parseMutationOp(op, argsContent, lineNumber);
  }
}

/**
 * Find the closing paren matching the one at `start`, respecting strings and nested braces.
 */
function findMatchingParen(str: string, start: number): number {
  let depth = 0;
  let inString = false;
  let stringChar = '';

  for (let i = start; i < str.length; i++) {
    const ch = str[i];
    if (inString) {
      if (ch === stringChar && str[i - 1] !== '\\') inString = false;
    } else {
      if (ch === '"' || ch === "'") {
        inString = true;
        stringChar = ch;
      } else if (ch === '(') {
        depth++;
      } else if (ch === ')') {
        depth--;
        if (depth === 0) return i;
      }
    }
  }
  return -1;
}

/**
 * Parse CREATE_FRAME/CREATE_TEXT/CREATE_RECT: var=OP(parentRef, {props})
 */
function parseCreateOp(op: string, variable: string, argsContent: string, lineNumber: number): ParsedOperation {
  const { simpleArgs, props } = splitArgs(argsContent, lineNumber);

  if (simpleArgs.length < 1) {
    throw new Error(`Line ${lineNumber}: ${op} requires a parent reference`);
  }

  const parent = resolveRef(simpleArgs[0]);

  const result: ParsedOperation = { op, variable, parent, props: props || {} };

  // For CREATE_TEXT, extract font properties for plugin-side font loading
  if (op === 'CREATE_TEXT' && props) {
    if (props.fontFamily) {
      result.fontFamily = props.fontFamily;
      delete props.fontFamily;
    }
    if (props.fontStyle) {
      result.fontStyle = props.fontStyle;
      delete props.fontStyle;
    }
    if (props.fontWeight !== undefined) {
      // Convert numeric weight to style name for font loading
      result.fontStyle = result.fontStyle || weightToStyle(props.fontWeight);
      delete props.fontWeight;
    }
    // Rename 'text' to 'characters' for Figma API
    if (props.text !== undefined) {
      props.characters = props.text;
      delete props.text;
    }
  }

  return result;
}

/**
 * Parse mutation ops: OP(nodeRef, {props})
 */
function parseMutationOp(op: string, argsContent: string, lineNumber: number): ParsedOperation {
  const { simpleArgs, props } = splitArgs(argsContent, lineNumber);

  if (simpleArgs.length < 1) {
    throw new Error(`Line ${lineNumber}: ${op} requires a node reference`);
  }

  return { op, nodeId: simpleArgs[0], props: props || {} };
}

/**
 * Parse simple ops: OP(nodeRef)
 */
function parseSimpleOp(op: string, argsContent: string, lineNumber: number): ParsedOperation {
  const { simpleArgs } = splitArgs(argsContent, lineNumber);

  if (simpleArgs.length < 1) {
    throw new Error(`Line ${lineNumber}: ${op} requires a node reference`);
  }

  return { op, nodeId: simpleArgs[0] };
}

/**
 * Parse REPARENT: REPARENT(nodeRef, newParentRef, index?)
 */
function parseReparentOp(argsContent: string, lineNumber: number): ParsedOperation {
  const { simpleArgs } = splitArgs(argsContent, lineNumber);

  if (simpleArgs.length < 2) {
    throw new Error(`Line ${lineNumber}: REPARENT requires nodeRef and newParentRef`);
  }

  const result: ParsedOperation = {
    op: 'REPARENT',
    nodeId: simpleArgs[0],
    newParent: simpleArgs[1],
  };

  if (simpleArgs.length >= 3) {
    const idx = parseInt(simpleArgs[2], 10);
    if (isNaN(idx)) {
      throw new Error(`Line ${lineNumber}: REPARENT index must be a number, got "${simpleArgs[2]}"`);
    }
    result.index = idx;
  }

  return result;
}

/**
 * Split the args content into simple args (before the {}) and a props object.
 */
function splitArgs(argsContent: string, lineNumber: number): {
  simpleArgs: string[];
  props: Record<string, any> | null;
} {
  if (!argsContent) return { simpleArgs: [], props: null };

  // Find the first { that's not inside a string
  const braceIdx = findFirstBrace(argsContent);

  if (braceIdx === -1) {
    // No props object — all simple args
    const args = splitTopLevel(argsContent, ',')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    return { simpleArgs: args, props: null };
  }

  // Everything before { is simple args
  const beforeBrace = argsContent.substring(0, braceIdx).trim().replace(/,\s*$/, '');
  const simpleArgs = beforeBrace
    ? splitTopLevel(beforeBrace, ',').map(s => s.trim()).filter(s => s.length > 0)
    : [];

  // Find matching closing brace
  const closeBrace = findMatchingBrace(argsContent, braceIdx);
  if (closeBrace === -1) {
    throw new Error(`Line ${lineNumber}: Unmatched brace in props`);
  }

  const propsStr = argsContent.substring(braceIdx, closeBrace + 1);
  const props = parsePropsObject(propsStr, lineNumber);

  // Check for additional simple args after the brace (uncommon but handle gracefully)
  const afterBrace = argsContent.substring(closeBrace + 1).trim();
  if (afterBrace.startsWith(',')) {
    const extraArgs = splitTopLevel(afterBrace.substring(1), ',')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    simpleArgs.push(...extraArgs);
  }

  return { simpleArgs, props };
}

function findFirstBrace(str: string): number {
  let inString = false;
  let stringChar = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (inString) {
      if (ch === stringChar && str[i - 1] !== '\\') inString = false;
    } else {
      if (ch === '"' || ch === "'") { inString = true; stringChar = ch; }
      else if (ch === '{') return i;
    }
  }
  return -1;
}

function findMatchingBrace(str: string, start: number): number {
  let depth = 0;
  let inString = false;
  let stringChar = '';
  for (let i = start; i < str.length; i++) {
    const ch = str[i];
    if (inString) {
      if (ch === stringChar && str[i - 1] !== '\\') inString = false;
    } else {
      if (ch === '"' || ch === "'") { inString = true; stringChar = ch; }
      else if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) return i; }
    }
  }
  return -1;
}

/**
 * Split a string on a delimiter, respecting nested braces and strings.
 */
function splitTopLevel(str: string, delimiter: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let inString = false;
  let stringChar = '';

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (inString) {
      current += ch;
      if (ch === stringChar && str[i - 1] !== '\\') inString = false;
    } else {
      if (ch === '"' || ch === "'") {
        inString = true;
        stringChar = ch;
        current += ch;
      } else if (ch === '{' || ch === '(' || ch === '[') {
        depth++;
        current += ch;
      } else if (ch === '}' || ch === ')' || ch === ']') {
        depth--;
        current += ch;
      } else if (ch === delimiter && depth === 0) {
        parts.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }

  if (current) parts.push(current);
  return parts;
}

/**
 * Parse a props object string with lenient JSON (unquoted keys allowed).
 */
function parsePropsObject(propsStr: string, lineNumber: number): Record<string, any> {
  // Add quotes around unquoted keys: word followed by :
  // Only at top level or after , or {
  const jsonStr = propsStr.replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":');

  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(
      `Line ${lineNumber}: Invalid props object: ${propsStr}\nAfter quoting keys: ${jsonStr}\nError: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

/**
 * Resolve a reference string to a value suitable for the protocol.
 * - "null" → null (current page)
 * - "$varName" → kept as-is for plugin-side resolution
 * - anything else → kept as-is (literal node ID)
 */
function resolveRef(ref: string): string | null {
  if (ref === 'null') return null;
  return ref;
}

/**
 * Convert numeric font weight to Figma style name.
 */
function weightToStyle(weight: number): string {
  if (weight <= 200) return 'Ultralight';
  if (weight <= 300) return 'Light';
  if (weight <= 400) return 'Regular';
  if (weight <= 500) return 'Medium';
  if (weight <= 600) return 'SemiBold';
  if (weight <= 700) return 'Bold';
  return 'Black';
}
