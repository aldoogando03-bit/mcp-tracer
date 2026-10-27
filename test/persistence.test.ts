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

/** A saved file holding one 2911 router with this name (and optional coordinates). */
const forgedDevice = (name: string, x?: number) =>
  JSON.stringify({ format: FILE_FORMAT, formatVersion: 1, topology: { devices: [{ name, model: "2911", ...(x === undefined ? {} : { x, y: 0 }) }] } });

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
    expect(resolveUserPath("lab.json", ".json")).toBe(path.join(dir, "lab.json"));
    expect(resolveUserPath("script", ".js")).toBe(path.join(dir, "script.js"));
    expect(resolveUserPath(path.join(dir, "abs"), ".js")).toBe(path.join(dir, "abs.js"));
  });

  it("accepts only the allowed extensions, case-insensitively", () => {
    expect(resolveUserPath("lab.JSON", ".json")).toBe(path.join(dir, "lab.JSON"));
    expect(resolveUserPath("out.TXT", ".js", [".js", ".txt"])).toBe(path.join(dir, "out.TXT"));
    expect(resolveUserPath("out.js", ".js", [".js", ".txt"])).toBe(path.join(dir, "out.js"));
    for (const name of ["evil.cmd", "evil.bat", "evil.ps1", "lab.txt", "lab.v2", "evil.json.cmd", "evil.cmd."]) {
      expect(() => resolveUserPath(name, ".json"), name).toThrow(/but only \.json files are allowed here/);
    }
    for (const name of ["evil.cmd", "evil.BAT", "evil.vbs", "lab.json", "x.js.exe"]) {
      expect(() => resolveUserPath(name, ".js", [".js", ".txt"]), name).toThrow(/only \.js and \.txt files are allowed here/);
    }
    // An NTFS alternate data stream ("x.cmd:s.json") would get past an extension check, so ":" is refused.
    expect(() => resolveUserPath("evil.cmd:s.json", ".json")).toThrow(/must not contain ":"/);
  });

  it("expands ~ to the home directory", () => {
    expect(resolveUserPath("~/labs/a.json", ".json")).toBe(path.join(homedir(), "labs", "a.json"));
    expect(resolveUserPath("~\\b.json", ".json")).toBe(path.join(homedir(), "b.json"));
    setTracerDir("~");
    expect(baseDir()).toBe(path.resolve(homedir()));
  });

  it.each([
    ["", /must not be empty/],
    ["   ", /must not be empty/],
    ["a\0b", /NUL/],
    ["labs/", /ends with a path separator/],
    ["~", /names a directory, not a file/],
    [".", /names a directory, not a file/],
    ["..", /names a directory, not a file/],
    ["labs/..", /names a directory, not a file/],
    ["C:", /names a directory, not a file/],
    ["x".repeat(1025), /too long/],
  ])("rejects %j", (input, message) => {
    expect(() => resolveUserPath(input, ".json")).toThrow(message);
  });

  it("rejects a path that is an existing directory instead of writing next to it", async () => {
    await mkdir(path.join(dir, "labs"));
    await mkdir(path.join(dir, "odd.json"));
    expect(() => resolveUserPath("labs", ".json")).toThrow(`${path.join(dir, "labs")} is a directory; give a file name inside it`);
    expect(() => resolveUserPath(path.join(dir, "odd.json"), ".json")).toThrow(/is a directory/);
    expect(resolveUserPath("labs/lab", ".json")).toBe(path.join(dir, "labs", "lab.json"));
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

  it("rejects a forged __proto__ device, whose IOS config could not survive a save/load round trip", () => {
    const text = `{"format":"${FILE_FORMAT}","formatVersion":1,"topology":{"devices":[{"name":"__proto__","model":"2911"}],` +
      `"configs":{"__proto__":["hostname X"]}}}`;
    expect(() => parseTopologyFile(text)).toThrow(/^Invalid topology in file: devices\[0\] "__proto__": Invalid device name/);
    const ctor = forgedDevice("Constructor");
    expect(() => parseTopologyFile(ctor)).toThrow(/"Constructor" is a reserved name/);
  });

  it("rejects files over the size limits of the tools", () => {
    const devices = Array.from({ length: 501 }, (_, i) => ({ name: `PC${i}`, model: "PC-PT" }));
    expect(() => parseTopologyFile(JSON.stringify({ devices }))).toThrow(/Invalid topology data[\s\S]*devices/);
    expect(() => parseTopologyFile(forgedDevice("R1", 100_001))).toThrow(/Invalid topology data/);
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
