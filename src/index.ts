#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { log } from "./log.js";
import { createServer } from "./server.js";
import { VERSION } from "./version.js";

try {
  await createServer().connect(new StdioServerTransport());
  log.info(`v${VERSION} running on stdio`);
} catch (e) {
  log.error("fatal:", e);
  process.exit(1);
}
