import { existsSync } from "node:fs";
import { mkdir, readFile, truncate, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FILE_FORMAT, FILE_FORMAT_VERSION, MAX_FILE_BYTES, baseDir, parseTopologyFile, readTextFile, resolveUserPath, serializeTopology,
  writeTextFile,
} from "../src/persistence.js";
import { Topology } from "../src/topology.js";
import { VERSION } from "../src/version.js";
import { cleanLab, makeTempDir, setTracerDir } from "./helpers.js";

let dir: string;
let cleanup: () => Promise<void>;
let restoreEnv: () => void;

beforeEach(async () => {
  ({ dir, cleanup } = await makeTempDir());
  restoreEnv = setTracerDir(dir);
});

afterEach(async () => {
  restoreEnv();
  await cleanup();
});

describe("path resolution", () => {
  it("resolves relative paths against MCP_TRACER_DIR, else the cwd", () => {
    expect(baseDir()).toBe(path.resolve(dir));
    expect(resolveUserPath("labs/vlan", ".json")).toBe(path.join(dir, "labs", "vlan.json"));
    setTracerDir("  ");
    expect(baseDir()).toBe(process.cwd());
    setTracerDir(undefined);
    expect(resolveUserPath("x", ".js")).toBe(path.join(process.cwd(), "x.js"));
  });

  it("adds the default extension only when the name has none", () => {
    expect(resolveUserPath("lab", ".json")).toBe(path.join(dir, "lab.json"));
    expect(resolveUserPath("lab.txt", ".json")).toBe(path.join(dir, "lab.txt"));
    expect(resolveUserPath("script", ".js")).toBe(path.join(dir, "script.js"));
    expect(resolveUserPath(path.join(dir, "abs"), ".js")).toBe(path.join(dir, "abs.js"));
  });

  it("expands ~ to the home directory", () => {
    expect(resolveUserPath("~/labs/a.json", ".json")).toBe(path.join(homedir(), "labs", "a.json"));
    setTracerDir("~");
    expect(baseDir()).toBe(path.resolve(homedir()));
  });

  it.each([
    ["", /must not be empty/],
    ["   ", /must not be empty/],
    ["a\0b", /NUL/],
    ["labs/", /ends with a path separator/],
  ])("rejects %j", (input, message) => {
    expect(() => resolveUserPath(input, ".json")).toThrow(message);
  });
});

describe("serializeTopology / parseTopologyFile", () => {
  it("writes the documented envelope as pretty JSON with a trailing newline", () => {
    const savedAt = new Date("2026-01-02T03:04:05.000Z");
    const text = serializeTopology(cleanLab(), savedAt);
    expect(text.endsWith("}\n")).toBe(true);
    const doc = JSON.parse(text);
    expect(doc).toEqual({
      format: FILE_FORMAT,
      formatVersion: FILE_FORMAT_VERSION,
      generator: `mcp-tracer v${VERSION}`,
      savedAt: "2026-01-02T03:04:05.000Z",
      topology: cleanLab().toJSON(),
    });
  });

  it("round-trips a topology", () => {
    const t = cleanLab();
    const loaded = parseTopologyFile(serializeTopology(t));
    expect(loaded.topology.toJSON()).toEqual(t.toJSON());
    expect(loaded.generator).toBe(`mcp-tracer v${VERSION}`);
    expect(loaded.savedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it("accepts a bare toJSON() object and a UTF-8 BOM", () => {
    const t = cleanLab();
    expect(parseTopologyFile(JSON.stringify(t.toJSON())).topology.toJSON()).toEqual(t.toJSON());
    expect(parseTopologyFile(String.fromCharCode(0xfeff) + serializeTopology(t)).topology.devices.size).toBe(3);
  });

  it.each([
    ["{ not json", /^Not valid JSON: /],
    ["[]", /expected a JSON object/],
    ["42", /expected a JSON object/],
    ["null", /expected a JSON object/],
    ['{"hello": 1}', /Not a topology file/],
    [JSON.stringify({ format: "something-else", formatVersion: 1, topology: {} }), /Unsupported file format "something-else"/],
    [JSON.stringify({ format: FILE_FORMAT, formatVersion: 2, topology: {} }), /format version 2 is newer than this server supports \(1\)/],
    [JSON.stringify({ format: FILE_FORMAT, formatVersion: 0, topology: {} }), /Invalid file header/],
    [JSON.stringify({ format: FILE_FORMAT, formatVersion: "1", topology: {} }), /Invalid file header/],
    [JSON.stringify({ format: FILE_FORMAT, formatVersion: 1 }), /"topology" field is missing/],
    [JSON.stringify({ format: FILE_FORMAT, formatVersion: 1, topology: { devices: "nope" } }), /^Invalid topology in file: Invalid topology data/],
  ])("rejects %s", (content, message) => {
    expect(() => parseTopologyFile(content)).toThrow(message);
  });

  it("rejects a forged topology that breaks the model's invariants", () => {
    const forged = (topology: unknown) => JSON.stringify({ format: FILE_FORMAT, formatVersion: 1, topology });
    const twoR1 = { devices: [{ name: "R1", model: "2911" }, { name: "r1", model: "2911" }] };
    expect(() => parseTopologyFile(forged(twoR1))).toThrow(/^Invalid topology in file: devices\[1\] "r1": A device named "R1" already exists/);
    const pcIos = { devices: [{ name: "PC1", model: "PC-PT" }], configs: { PC1: ["hostname x"] } };
    expect(() => parseTopologyFile(forged(pcIos))).toThrow(/does not run IOS/);
    const reusedPort = {
      devices: [{ name: "S1", model: "2960-24TT" }, { name: "PC1", model: "PC-PT" }, { name: "PC2", model: "PC-PT" }],
      links: [
        { dev1: "PC1", port1: "FastEthernet0", dev2: "S1", port2: "FastEthernet0/1" },
        { dev1: "PC2", port1: "FastEthernet0", dev2: "S1", port2: "FastEthernet0/1" },
      ],
    };
    expect(() => parseTopologyFile(forged(reusedPort))).toThrow(/is already used/);
  });
});

describe("writeTextFile / readTextFile", () => {
  it("creates missing parent folders and refuses to overwrite unless asked", async () => {
    const file = resolveUserPath("a/b/c/lab", ".json");
    await writeTextFile(file, "one", false);
    expect(await readFile(file, "utf8")).toBe("one");
    await expect(writeTextFile(file, "two", false)).rejects.toThrow(`${file} already exists. Pass overwrite: true to replace it`);
    expect(await readFile(file, "utf8")).toBe("one");
    await writeTextFile(file, "three", true);
    expect(await readTextFile(file)).toBe("three");
  });

  it("names the absolute path of a missing file", async () => {
    const file = path.join(dir, "missing.json");
    await expect(readTextFile(file)).rejects.toThrow(`File not found: ${file}`);
  });

  it("refuses a directory", async () => {
    await mkdir(path.join(dir, "folder"));
    await expect(readTextFile(path.join(dir, "folder"))).rejects.toThrow(/is a directory|not a regular file/);
  });

  it("refuses files over the size cap before reading them", async () => {
    const small = path.join(dir, "small.json");
    await writeFile(small, "x".repeat(100));
    await expect(readTextFile(small, 99)).rejects.toThrow(/the limit is/);
    expect(await readTextFile(small, 100)).toHaveLength(100);

    const big = path.join(dir, "big.json");
    await writeFile(big, "");
    await truncate(big, MAX_FILE_BYTES + 1);
    await expect(readTextFile(big)).rejects.toThrow(`${big} is 5.0 MB; the limit is 5 MB.`);
  });

  it("saves and loads a topology through the file system", async () => {
    const t = cleanLab();
    const file = resolveUserPath("saved", ".json");
    await writeTextFile(file, serializeTopology(t), false);
    expect(existsSync(path.join(dir, "saved.json"))).toBe(true);
    expect(parseTopologyFile(await readTextFile(file)).topology.toJSON()).toEqual(t.toJSON());
  });
});

describe("empty topology", () => {
  it("round-trips too", () => {
    expect(parseTopologyFile(serializeTopology(new Topology())).topology.toJSON()).toEqual(new Topology().toJSON());
  });
});
