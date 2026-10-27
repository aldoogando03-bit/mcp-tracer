import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPrompts } from "./prompts.js";
import { registerResources } from "./resources.js";
import { Session } from "./session.js";
import { registerFileTools } from "./tools/files.js";
import { registerTopologyTools } from "./tools/topology.js";
import { VERSION } from "./version.js";

/** Builds a fully registered server with its own Session (not connected to any transport). */
export function createServer(): McpServer {
  const server = new McpServer({ name: "mcp-tracer", version: VERSION });
  const session = new Session();
  registerTopologyTools(server, session);
  registerFileTools(server, session);
  registerResources(server);
  registerPrompts(server);
  return server;
}
