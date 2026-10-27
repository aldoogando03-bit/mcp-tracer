import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** A tool result with one text block per argument. */
export const text = (...parts: string[]): CallToolResult => ({ content: parts.map((t) => ({ type: "text" as const, text: t })) });

/** An `isError` result: domain failures must never be returned as successes. */
export const fail = (message: string): CallToolResult => ({ ...text(`Error: ${message}`), isError: true });

/** Runs a handler body; a returned string becomes a text result, a thrown Error becomes `fail(message)`. */
export function safe(fn: () => string | CallToolResult): CallToolResult {
  try {
    const r = fn();
    return typeof r === "string" ? text(r) : r;
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}
