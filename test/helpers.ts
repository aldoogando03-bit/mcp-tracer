/** Shared test helpers (not a test file: vitest only collects *.test.ts). */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Topology } from "../src/topology.js";

/** One recorded PTBuilder call: function name followed by its arguments. */
export type Call = [fn: string, ...args: unknown[]];

/**
 * Runs a generated script exactly like PTBuilder's Builder Code Editor does: every "\n" is stripped
 * (interface.js `code.replace(/\n/g, "")`), then the result runs as a function body (runcode.js `new Function`).
 * The four user functions are recorder stubs; returns the calls in order.
 */
export function runInPTBuilder(script: string): Call[] {
  const code = script.replace(/\n/g, "");
  const calls: Call[] = [];
  const recorder =
    (fn: string) =>
    (...args: unknown[]) => {
      calls.push([fn, ...args]);
      return true;
    };
  const run = new Function("addDevice", "addLink", "configureIosDevice", "configurePcIp", code);
  run(recorder("addDevice"), recorder("addLink"), recorder("configureIosDevice"), recorder("configurePcIp"));
  return calls;
}

/**
 * The script with the contents of double-quoted string literals and block comments blanked out,
 * so checks such as "no // outside strings" only see code.
 */
export function codeOutsideStrings(script: string): string {
  let out = "";
  let i = 0;
  while (i < script.length) {
    const c = script[i];
    if (c === '"') {
      out += '"';
      i++;
      while (i < script.length && script[i] !== '"') i += script[i] === "\\" ? 2 : 1;
      out += '"';
      i++;
    } else if (c === "/" && script[i + 1] === "*") {
      const end = script.indexOf("*/", i + 2);
      if (end < 0) throw new Error("Unterminated block comment");
      out += " ";
      i = end + 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** A clean lab: every port used is verified, so validate() reports no issues at all. */
export function cleanLab(): Topology {
  return Topology.fromSpec({
    devices: [
      { name: "R1", model: "2911" },
      { name: "S1", model: "2960-24TT" },
      { name: "PC1", model: "PC-PT" },
    ],
    links: [
      { dev1: "R1", port1: "GigabitEthernet0/0", dev2: "S1", port2: "GigabitEthernet0/1" },
      { dev1: "PC1", port1: "FastEthernet0", dev2: "S1", port2: "FastEthernet0/1" },
    ],
    ios: [
      {
        name: "R1",
        commands: ["hostname R1", "interface GigabitEthernet0/0", "ip address 192.168.1.1 255.255.255.0", "no shutdown", "exit"],
      },
      { name: "S1", commands: ["hostname S1"] },
    ],
    pcs: [{ name: "PC1", ip: "192.168.1.10", mask: "255.255.255.0", gateway: "192.168.1.1" }],
  }).topology;
}

/** Creates a fresh temp directory; call the returned cleanup in afterEach. */
export async function makeTempDir(prefix = "mcp-tracer-test-"): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/**
 * Sets MCP_TRACER_DIR for the duration of a test and returns a restore function
 * (vitest runs each test file in its own worker, so this never leaks across files).
 */
export function setTracerDir(dir: string | undefined): () => void {
  const previous = process.env.MCP_TRACER_DIR;
  if (dir === undefined) delete process.env.MCP_TRACER_DIR;
  else process.env.MCP_TRACER_DIR = dir;
  return () => {
    if (previous === undefined) delete process.env.MCP_TRACER_DIR;
    else process.env.MCP_TRACER_DIR = previous;
  };
}
