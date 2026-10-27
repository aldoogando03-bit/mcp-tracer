import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { MAX_FILE_BYTES, baseDir, parseTopologyFile, readTextFile, resolveUserPath, serializeTopology, writeTextFile } from "../persistence.js";
import { issueReport, plural, renderScript } from "../render.js";
import type { Session } from "../session.js";
import { LIMITS, type Topology } from "../topology.js";
import { formatValidation, validate } from "../validate.js";
import { fail, text } from "./util.js";

/** Extensions each file tool accepts (the first one is added when the name has none). */
const TOPOLOGY_EXTS = [".json"];
const SCRIPT_EXTS = [".js", ".txt"];

/** Async counterpart of util.safe(): a returned string becomes a text result, a thrown Error becomes fail(message). */
async function safeAsync(fn: () => Promise<string | CallToolResult>): Promise<CallToolResult> {
  try {
    const r = await fn();
    return typeof r === "string" ? text(r) : r;
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

const where = () =>
  `Use an absolute path: relative paths resolve against $MCP_TRACER_DIR if set, else the server's working directory ` +
  `(now ${baseDir()}), which MCP clients often set arbitrarily. "~" is the user's home directory.`;

const filePath = (what: string, exts: string[]) =>
  z
    .string()
    .min(1)
    .max(LIMITS.path)
    .describe(
      `${what} Only ${exts.join(" or ")} file names are accepted; ${exts[0]} is added when the file name has no extension. ` +
        "Absolute path recommended."
    );
const overwrite = z.boolean().default(false).describe("true = replace the file if it already exists.");

const counts = (t: Topology) =>
  `${plural(t.devices.size, "device")}, ${plural(t.links.length, "link")}, ${plural(t.configs.size, "IOS config")}, ` +
  `${plural(t.pcIps.size, "host IP config")}`;

export function registerFileTools(server: McpServer, session: Session): void {
  const paths = where();
  server.registerTool(
    "save_topology",
    {
      title: "Save topology",
      description:
        "Save the current topology (devices, links, IOS commands, host IP configurations) to a JSON file that load_topology " +
        `can read back. ${paths} Missing folders are created. Refuses to replace an existing file unless overwrite: true. ` +
        "The result shows the absolute path written.",
      inputSchema: { path: filePath("File to write, e.g. C:\\labs\\vlans.json or /home/me/labs/vlans.json.", TOPOLOGY_EXTS), overwrite },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    (a) =>
      safeAsync(async () => {
        const t = session.topology;
        const abs = resolveUserPath(a.path, ".json", TOPOLOGY_EXTS);
        await writeTextFile(abs, serializeTopology(t), a.overwrite);
        return `Saved ${counts(t)} to ${abs}${t.devices.size ? "" : " (the topology is empty)"}.`;
      })
  );

  server.registerTool(
    "load_topology",
    {
      title: "Load topology",
      description:
        "Replace the current topology with one read from a file written by save_topology (a bare get_topology JSON object " +
        `is accepted too). ${paths} Atomic: the file is fully parsed and validated (models, ports, links, IOS and host IP ` +
        `rules) before anything changes; on any error the current topology is kept. Max ${MAX_FILE_BYTES / 1048576} MB.`,
      inputSchema: { path: filePath("File to read.", TOPOLOGY_EXTS) },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    (a) =>
      safeAsync(async () => {
        const abs = resolveUserPath(a.path, ".json", TOPOLOGY_EXTS);
        let loaded;
        try {
          loaded = parseTopologyFile(await readTextFile(abs));
        } catch (e) {
          throw new Error(`Could not load ${abs}; the current topology is unchanged.\n${(e as Error).message}`);
        }
        const t = loaded.topology;
        session.replaceTopology(t);
        const by = loaded.generator ? ` (saved by ${loaded.generator}${loaded.savedAt ? ` at ${loaded.savedAt}` : ""})` : "";
        const lines = [`Loaded ${counts(t)} from ${abs}${by}. The previous topology was replaced.`];
        lines.push(formatValidation(validate(t)));
        return lines.join("\n");
      })
  );

  server.registerTool(
    "export_script",
    {
      title: "Export PTBuilder script",
      description:
        "Write the PTBuilder script for the current topology to a file, for users who prefer a file to copying from chat. " +
        `${paths} Same validation as generate_script: errors block the export unless force: true. Refuses to replace an ` +
        "existing file unless overwrite: true. The user then copies the whole file into Extensions > Builder Code Editor in a " +
        "new, empty Packet Tracer workspace and clicks Run.",
      inputSchema: {
        path: filePath("File to write, e.g. C:\\labs\\vlans.js.", SCRIPT_EXTS),
        overwrite,
        force: z.boolean().default(false).describe("Export even if validation reports errors."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    (a) =>
      safeAsync(async () => {
        const abs = resolveUserPath(a.path, ".js", SCRIPT_EXTS);
        const r = renderScript(session.topology, { force: a.force });
        await writeTextFile(abs, `${r.script}\n`, a.overwrite);
        const lines = [
          `Wrote the PTBuilder script (${plural(r.script.split("\n").length, "line")}) to ${abs}.`,
          "Tell the user to open a new, empty workspace (File > New), open Extensions > Builder Code Editor, paste the whole file and click Run.",
        ];
        const report = issueReport(r);
        if (report) lines.push(report);
        return lines.join("\n");
      })
  );
}
