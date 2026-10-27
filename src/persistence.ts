/**
 * Topology files and user path handling for save_topology, load_topology and export_script. No MCP imports.
 * File format: { format, formatVersion, generator, savedAt, topology: Topology.toJSON() }.
 */
import { statSync } from "node:fs";
import { mkdir, open, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { LIMITS, Topology } from "./topology.js";
import { VERSION } from "./version.js";

export const FILE_FORMAT = "mcp-tracer/topology";
export const FILE_FORMAT_VERSION = 1;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

const envelopeSchema = z.object({
  format: z.string(),
  formatVersion: z.number().int().min(1),
  generator: z.string().optional(),
  savedAt: z.string().optional(),
  topology: z.unknown().optional(),
});

export type LoadedFile = { topology: Topology; generator?: string; savedAt?: string };

const expandHome = (p: string) => (p === "~" ? homedir() : /^~[\\/]/.test(p) ? path.join(homedir(), p.slice(2)) : p);

/** Directory that relative paths resolve against: $MCP_TRACER_DIR if set, else the process cwd. */
export function baseDir(): string {
  const env = process.env.MCP_TRACER_DIR?.trim();
  return env ? path.resolve(expandHome(env)) : process.cwd();
}

/**
 * Absolute path for user input: `~` expanded, relative paths resolved against baseDir(), `ext` added if the name has
 * none. Only the extensions in `allowed` are accepted (case-insensitive), so the file tools can never write a
 * .cmd, .bat or other executable file. Names that denote a directory (~, ., .., C:, an existing folder) are refused.
 */
export function resolveUserPath(input: string, ext: string, allowed: readonly string[] = [ext]): string {
  const p = input.trim();
  if (!p) throw new Error("Path must not be empty.");
  if (p.length > LIMITS.path) throw new Error(`Path is too long (at most ${LIMITS.path} characters).`);
  if (p.includes("\0")) throw new Error("Path must not contain NUL characters.");
  if (/[\\/]$/.test(p)) throw new Error(`"${input}" ends with a path separator; give a file name.`);
  const last = p.split(/[\\/]/).pop()!;
  if (["~", ".", ".."].includes(last) || /^[a-z]:$/i.test(last)) {
    throw new Error(`"${input}" names a directory, not a file; give a file name such as lab${ext}.`);
  }
  if (last.includes(":")) throw new Error(`"${input}": the file name must not contain ":".`);
  const abs = path.resolve(baseDir(), expandHome(p));
  if (statSync(abs, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`${abs} is a directory; give a file name inside it, e.g. ${path.join(abs, `lab${ext}`)}.`);
  }
  const e = path.extname(abs);
  if (!e) return abs + ext;
  if (!allowed.includes(e.toLowerCase())) {
    throw new Error(
      `${abs} has the extension "${e}", but only ${allowed.join(" and ")} files are allowed here. ` +
        `Use ${allowed.length > 1 ? "one of those" : `a ${ext} name`}, or leave the extension out to get ${ext}.`
    );
  }
  return abs;
}

/** Turns a Node fs error into a message that names the absolute path. Non-fs errors pass through. */
function fsError(e: unknown, abs: string): Error {
  const code = (e as NodeJS.ErrnoException)?.code;
  if (!code) return e instanceof Error ? e : new Error(String(e));
  const messages: Record<string, string> = {
    EEXIST: `${abs} already exists. Pass overwrite: true to replace it, or choose another path.`,
    ENOENT: `File not found: ${abs}`,
    EISDIR: `${abs} is a directory; give a file path.`,
    ENOTDIR: `A parent of ${abs} is not a directory.`,
    EACCES: `Permission denied: ${abs}`,
    EPERM: `Operation not permitted on ${abs} (permissions, or the file is locked).`,
    EROFS: `Read-only file system: ${abs}`,
    EBUSY: `${abs} is busy or locked by another program.`,
  };
  return new Error(messages[code] ?? `Cannot access ${abs}: ${(e as Error).message}`);
}

/** Writes UTF-8 text, creating parent directories. Without `overwrite`, an existing file is never replaced. */
export async function writeTextFile(abs: string, content: string, overwrite: boolean): Promise<void> {
  try {
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content, { encoding: "utf8", flag: overwrite ? "w" : "wx" });
  } catch (e) {
    throw fsError(e, abs);
  }
}

/** Reads a UTF-8 file of at most `maxBytes` (checked before reading). */
export async function readTextFile(abs: string, maxBytes = MAX_FILE_BYTES): Promise<string> {
  let fh: Awaited<ReturnType<typeof open>> | undefined;
  try {
    fh = await open(abs, "r");
    const st = await fh.stat();
    if (!st.isFile()) throw new Error(`${abs} is not a regular file.`);
    if (st.size > maxBytes) {
      throw new Error(`${abs} is ${(st.size / 1048576).toFixed(1)} MB; the limit is ${maxBytes / 1048576} MB.`);
    }
    return await fh.readFile({ encoding: "utf8" });
  } catch (e) {
    throw fsError(e, abs);
  } finally {
    await fh?.close().catch(() => undefined);
  }
}

/** The saved-file document for a topology: pretty JSON with a trailing newline. */
export function serializeTopology(t: Topology, savedAt = new Date()): string {
  const doc = {
    format: FILE_FORMAT,
    formatVersion: FILE_FORMAT_VERSION,
    generator: `mcp-tracer v${VERSION}`,
    savedAt: savedAt.toISOString(),
    topology: t.toJSON(),
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

function rebuild(data: unknown): Topology {
  try {
    return Topology.fromJSON(data);
  } catch (e) {
    throw new Error(`Invalid topology in file: ${(e as Error).message}`);
  }
}

/**
 * Parses a saved file (or a bare toJSON() object) into a NEW Topology rebuilt through the public mutators.
 * Throws with a clear message on bad JSON, a foreign format, a newer formatVersion or invalid topology data.
 */
export function parseTopologyFile(content: string): LoadedFile {
  let data: unknown;
  try {
    data = JSON.parse(content.replace(/^\uFEFF/, ""));
  } catch (e) {
    throw new Error(`Not valid JSON: ${(e as Error).message}`);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Not a topology file: expected a JSON object.");
  }
  const obj = data as Record<string, unknown>;
  if (!("format" in obj) && !("formatVersion" in obj) && !("topology" in obj)) {
    if (!("devices" in obj)) {
      throw new Error(`Not a topology file: expected {"format": "${FILE_FORMAT}", ...} or a bare topology object with a "devices" array.`);
    }
    return { topology: rebuild(obj) };
  }
  if (typeof obj.format === "string" && obj.format !== FILE_FORMAT) {
    throw new Error(`Unsupported file format "${obj.format}": expected "${FILE_FORMAT}".`);
  }
  if (typeof obj.formatVersion === "number" && obj.formatVersion > FILE_FORMAT_VERSION) {
    throw new Error(
      `File format version ${obj.formatVersion} is newer than this server supports (${FILE_FORMAT_VERSION}). Upgrade mcp-tracer to load it.`
    );
  }
  const env = envelopeSchema.safeParse(obj);
  if (!env.success) throw new Error(`Invalid file header:\n${z.prettifyError(env.error)}`);
  if (env.data.topology === undefined) throw new Error('Invalid file: the "topology" field is missing.');
  return { topology: rebuild(env.data.topology), generator: env.data.generator, savedAt: env.data.savedAt };
}
