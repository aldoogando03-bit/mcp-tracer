/** stderr-only logger: stdout is reserved for the MCP stdio protocol. */
const PREFIX = "[packet-tracer-mcp]";

export const log = {
  info: (...args: unknown[]) => console.error(PREFIX, "info:", ...args),
  warn: (...args: unknown[]) => console.error(PREFIX, "warn:", ...args),
  error: (...args: unknown[]) => console.error(PREFIX, "error:", ...args),
};
