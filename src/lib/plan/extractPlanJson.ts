/**
 * Locate the plan JSON inside a larger text blob so a whole shared/pasted AI
 * message (prose wrapped around the plan) parses cleanly. Conservative: only
 * overrides the input when it confidently finds a fenced code block or a
 * balanced top-level object; otherwise returns the text unchanged so
 * parsePlanImport's existing "not valid JSON" error still fires. Never throws.
 */
export function extractPlanJson(text: string): string {
  const raw = text ?? '';

  // 1. First fenced code block (```json … ``` or ``` … ```) whose body has a brace.
  const fence = raw.match(/```[a-zA-Z0-9]*[ \t]*\r?\n?([\s\S]*?)```/);
  if (fence && fence[1] && fence[1].includes('{')) {
    const inner = balancedObject(fence[1]);
    return inner ?? fence[1];
  }

  // 2. Otherwise, the first balanced top-level { … } object in the whole text.
  const obj = balancedObject(raw);
  return obj ?? raw;
}

/** Return the first brace-balanced `{ … }` substring (string/escape aware), or null. */
function balancedObject(s: string): string | null {
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null; // unbalanced
}
