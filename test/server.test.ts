import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ErrorCode, McpError, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { makeTempDir, runInPTBuilder, setTracerDir } from "./helpers.js";

const TOOLS = [
  "add_device", "add_link", "remove_device", "remove_link", "rename_device", "configure_device", "configure_pc", "build_topology",
  "get_topology", "validate_config", "generate_script", "reset_topology", "save_topology", "load_topology", "export_script",
];
const READ_ONLY = ["get_topology", "validate_config", "generate_script"];
const PROMPTS = ["vlan_lab", "ospf_lab", "dhcp_lab", "nat_lab"];

type ToolCall = { isError: boolean; text: string; texts: string[] };

let client: Client;
let closeAll: () => Promise<void>;

beforeEach(async () => {
  const server = createServer();
  client = new Client({ name: "mcp-tracer-tests", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  closeAll = async () => {
    await client.close();
    await server.close();
  };
});

afterEach(async () => {
  await closeAll();
});

async function call(name: string, args: Record<string, unknown> = {}): Promise<ToolCall> {
  const r = (await client.callTool({ name, arguments: args })) as CallToolResult;
  const texts = r.content.map((c) => (c.type === "text" ? c.text : `<${c.type}>`));
  return { isError: r.isError === true, text: texts.join("\n"), texts };
}

/** Calls a tool and fails the test with the tool's message if it returned isError. */
async function ok(name: string, args: Record<string, unknown> = {}): Promise<ToolCall> {
  const r = await call(name, args);
  expect(r.isError, `${name} failed: ${r.text}`).toBe(false);
  return r;
}

async function readJsonResource(uri: string): Promise<Record<string, unknown>> {
  const r = await client.readResource({ uri });
  expect(r.contents).toHaveLength(1);
  const [c] = r.contents;
  expect(c.mimeType).toBe("application/json");
  expect("text" in c).toBe(true);
  return JSON.parse((c as { text: string }).text) as Record<string, unknown>;
}

describe("tools/list", () => {
  it("has exactly the 15 tools, each with a title, description and annotations", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOLS].sort());
    for (const t of tools) {
      expect(t.title, t.name).toBeTruthy();
      expect(t.description?.length, t.name).toBeGreaterThan(20);
      expect(t.annotations, t.name).toBeDefined();
      expect(t.annotations?.readOnlyHint, t.name).toBe(READ_ONLY.includes(t.name));
      expect(t.annotations?.openWorldHint, t.name).toBe(false);
      if (!READ_ONLY.includes(t.name)) expect(typeof t.annotations?.destructiveHint, t.name).toBe("boolean");
      expect(t.inputSchema.type, t.name).toBe("object");
    }
  });
});

describe("tools/call", () => {
  it("builds a lab step by step and generates a runnable script", async () => {
    expect((await ok("add_device", { name: "R1", model: "2911" })).text).toMatch(/^Added R1: 2911; no x\/y given/);
    expect((await ok("add_device", { name: "S1", model: "Catalyst 2960" })).text).toMatch(/^Added S1: 2960-24TT \(resolved from "Catalyst 2960"\)/);
    expect((await ok("add_device", { name: "PC1", model: "pc", x: 100, y: 400 })).text).toMatch(/^Added PC1: PC-PT \(resolved from "pc"\) at \(100, 400\)/);
    await ok("add_device", { name: "SRV1", model: "Server" });

    expect((await ok("add_link", { dev1: "R1", port1: "Gi0/0", dev2: "S1", port2: "gi0/1" })).text).toBe(
      "Linked R1:GigabitEthernet0/0 <-> S1:GigabitEthernet0/1 (cable: straight, inferred)."
    );
    await ok("add_link", { dev1: "PC1", port1: "Fa0", dev2: "S1", port2: "Fa0/1" });
    await ok("add_link", { dev1: "srv1", port1: "FastEthernet0", dev2: "s1", port2: "FastEthernet0/2" });

    const ios = await ok("configure_device", {
      name: "R1",
      ios_commands: ["enable", "configure terminal", "hostname R1", "interface GigabitEthernet0/0", "ip address 192.168.1.1 255.255.255.0", "no shutdown", "exit", "end"],
    });
    expect(ios.text).toMatch(/^R1: added 5 IOS commands \(5 total\)\.\nDropped 3 lines .*: enable \| configure terminal \| end$/);

    expect((await ok("configure_pc", { name: "PC1", dhcp: true })).text).toBe("PC1: DHCP.");
    expect((await ok("configure_pc", { name: "SRV1", ip: "192.168.1.100/24", gateway: "192.168.1.1" })).text).toBe(
      "SRV1: 192.168.1.100 255.255.255.0, gateway 192.168.1.1."
    );

    const validation = await ok("validate_config");
    expect(validation.text).not.toContain("Errors (");
    expect(validation.text).toContain("No errors: generate_script will run.");

    const topology = JSON.parse((await ok("get_topology")).text);
    expect(topology.devices.map((d: { name: string }) => d.name)).toEqual(["R1", "S1", "PC1", "SRV1"]);
    expect(topology.devices[2]).toEqual({ name: "PC1", model: "PC-PT", x: 100, y: 400, autoPlaced: false });
    expect(topology.links[0]).toMatchObject({ cable: "straight", cableInferred: true });

    const generated = await ok("generate_script");
    const calls = runInPTBuilder(generated.texts[0]);
    expect(calls.map((c) => c[0])).toEqual([
      "addDevice", "addDevice", "addDevice", "addDevice", "addLink", "addLink", "addLink", "configureIosDevice", "configurePcIp", "configurePcIp",
    ]);
    expect(calls).toContainEqual(["configurePcIp", "PC1", true]);
    expect(generated.texts[1]).toMatch(/^Warnings:\n- WARNING \[UNVERIFIED_PORT\]/);
  });

  it("blocks generate_script on validation errors, and force overrides", async () => {
    await ok("add_device", { name: "R1", model: "2911" });
    await ok("add_device", { name: "S1", model: "2960-24TT" });
    await ok("add_link", { dev1: "R1", port1: "Gi0/0", dev2: "S1", port2: "Gi0/1", cable: "serial" });

    expect((await ok("validate_config")).text).toMatch(/^Errors \(1\):\n- \[CABLE_INCOMPATIBLE\]/);
    const blocked = await call("generate_script");
    expect(blocked.isError).toBe(true);
    expect(blocked.text).toMatch(/^Error: The topology has 1 error; fix them or pass force: true\.\n- ERROR \[CABLE_INCOMPATIBLE\]/);

    const forced = await ok("generate_script", { force: true });
    expect(forced.texts).toHaveLength(2);
    expect(runInPTBuilder(forced.texts[0])).toContainEqual(["addLink", "R1", "GigabitEthernet0/0", "S1", "GigabitEthernet0/1", "serial"]);
    expect(forced.texts[1]).toMatch(/^Generated with force: true despite these issues:\n- ERROR \[CABLE_INCOMPATIBLE\]/);
  });

  it("returns domain failures as isError results", async () => {
    const unknown = await call("add_device", { name: "R1", model: "2912" });
    expect(unknown).toMatchObject({ isError: true });
    expect(unknown.text).toMatch(/^Error: Unknown model "2912"\. Closest PTBuilder model keys: .*2911/);

    await ok("add_device", { name: "PC1", model: "PC-PT" });
    expect((await call("configure_device", { name: "PC1", ios_commands: ["hostname x"] })).isError).toBe(true);
    expect((await call("remove_link", { device: "PC1", port: "Fa0" })).text).toMatch(/^Error: No link uses PC1:FastEthernet0/);
  });

  it("returns input validation errors as isError results instead of throwing", async () => {
    const missing = await call("add_device", { name: "R1" });
    expect(missing.isError).toBe(true);
    expect(missing.text).toMatch(/Input validation error/);

    const badType = await call("add_device", { name: "R1", model: "2911", x: "left", y: 1 });
    expect(badType.isError).toBe(true);

    const badCable = await call("add_link", { dev1: "a", port1: "b", dev2: "c", port2: "d", cable: "wireless" });
    expect(badCable.isError).toBe(true);
    expect(badCable.text).toMatch(/cable/);

    const empty = await call("add_device", { name: "", model: "2911" });
    expect(empty.isError).toBe(true);

    expect((await call("no_such_tool")).isError).toBe(true);
    expect(JSON.parse((await ok("get_topology")).text).devices).toEqual([]);
  });

  it("enforces the device name rule, the coordinate range and the input size limits", async () => {
    const badName = await call("add_device", { name: "R1 & del", model: "2911" });
    expect(badName.isError).toBe(true);
    expect(badName.text).toMatch(/^Error: Invalid device name "R1 & del": use 1-64 characters: letters, digits, spaces and \. _ \( \) \/ -/);
    expect((await call("add_device", { name: "constructor", model: "2911" })).text).toMatch(/is a reserved name/);

    const far = await call("add_device", { name: "R1", model: "2911", x: 6e17, y: 100 });
    expect(far.isError).toBe(true);
    expect(far.text).toMatch(/Input validation error/);

    const tooLong = [
      call("add_device", { name: "x".repeat(65), model: "2911" }),
      call("add_device", { name: "R1", model: "x".repeat(65) }),
      call("add_link", { dev1: "a", port1: "p".repeat(65), dev2: "c", port2: "d" }),
      call("configure_device", { name: "R1", ios_commands: ["x".repeat(513)] }),
      call("configure_device", { name: "R1", ios_commands: Array(2001).fill("ip routing") }),
      call("configure_pc", { name: "PC1", ip: "1".repeat(33) }),
      call("build_topology", { devices: Array.from({ length: 501 }, (_, i) => ({ name: `PC${i}`, model: "PC-PT" })) }),
      call("save_topology", { path: "x".repeat(1025) }),
    ];
    for (const r of await Promise.all(tooLong)) {
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/Input validation error/);
    }
    expect(JSON.parse((await ok("get_topology")).text).devices).toEqual([]);

    const { tools } = await client.listTools();
    const addDevice = tools.find((t) => t.name === "add_device")!;
    expect(addDevice.description).toContain("letters, digits, spaces and . _ ( ) / -");
    expect(JSON.stringify(addDevice.inputSchema)).toContain('"maximum":100000');
  });

  it("removes, renames and resets", async () => {
    await ok("build_topology", {
      devices: [{ name: "R1", model: "2911" }, { name: "S1", model: "2960-24TT" }, { name: "PC1", model: "PC-PT" }],
      links: [
        { dev1: "R1", port1: "Gi0/0", dev2: "S1", port2: "Gi0/1" },
        { dev1: "PC1", port1: "Fa0", dev2: "S1", port2: "Fa0/1" },
      ],
      ios: [{ name: "R1", commands: ["hostname R1"] }],
      pcs: [{ name: "PC1", dhcp: true }],
    });
    expect((await ok("rename_device", { name: "r1", new_name: "Edge" })).text).toBe("Renamed R1 to Edge. Its IOS hostname command was not changed.");
    expect((await ok("remove_link", { device: "S1", port: "gi0/1" })).text).toBe("Removed link Edge:GigabitEthernet0/0 <-> S1:GigabitEthernet0/1.");
    expect((await ok("remove_device", { name: "PC1" })).text).toBe(
      "Removed PC1 (PC-PT) and 1 link (PC1:FastEthernet0 <-> S1:FastEthernet0/1), its IP configuration."
    );
    expect((await ok("reset_topology")).text).toBe("Topology cleared.");
    expect(JSON.parse((await ok("get_topology")).text)).toMatchObject({ devices: [], links: [], configs: {}, pcIps: [] });
  });

  it("build_topology is atomic: a bad item leaves the current topology untouched", async () => {
    await ok("add_device", { name: "KEEP", model: "2911" });
    const r = await call("build_topology", {
      devices: [{ name: "R1", model: "2911" }, { name: "PC1", model: "PC-PT" }],
      links: [{ dev1: "R1", port1: "Gi0/0", dev2: "PC1", port2: "Fa0" }],
      ios: [{ name: "PC1", commands: ["hostname PC1"] }],
    });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/^Error: ios\[0\] "PC1": PC1 \(PC-PT\) does not run IOS/);
    expect(JSON.parse((await ok("get_topology")).text).devices.map((d: { name: string }) => d.name)).toEqual(["KEEP"]);
  });
});

describe("resources", () => {
  it("lists pt://catalog and the per-model template", async () => {
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toContain("pt://catalog");
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map((t) => t.uriTemplate)).toContain("pt://catalog/{model}");
  });

  it("serves the catalog as JSON with models, other PTBuilder keys and cable types", async () => {
    const catalog = await readJsonResource("pt://catalog");
    const models = catalog.models as { model: string; ports: [string, string, boolean][] }[];
    expect(models.map((m) => m.model)).toEqual(expect.arrayContaining(["2911", "2960-24TT", "PC-PT", "Server-PT"]));
    expect(models.find((m) => m.model === "2911")!.ports[0]).toEqual(["GigabitEthernet0/0", "gigabitethernet", true]);
    expect(catalog.otherPtbuilderModels).toContain("Router-PT");
    expect((catalog.cableTypes as { type: string }[]).map((c) => c.type)).toContain("straight");
  });

  it("resolves aliases and URL-encoded names through the template", async () => {
    expect(await readJsonResource("pt://catalog/4331")).toMatchObject({ model: "ISR4331", resolvedFrom: "4331", category: "router" });
    expect(await readJsonResource("pt://catalog/2911")).not.toHaveProperty("resolvedFrom");
    expect(await readJsonResource("pt://catalog/IP%20Phone%207960")).toMatchObject({ model: "7960", resolvedFrom: "IP Phone 7960" });
    expect(await readJsonResource("pt://catalog/Router-PT")).toMatchObject({ model: "Router-PT", catalogued: false, ios: true, ports: [] });
    await expect(client.readResource({ uri: "pt://catalog/banana" })).rejects.toThrow(/Unknown model "banana"/);
  });

  it("answers an unknown model with an InvalidParams protocol error, as the SDK does for unknown resources", async () => {
    // The SDK has no "resource not found" code (-32002), so -32602 InvalidParams it is.
    const err = await client.readResource({ uri: "pt://catalog/constructor" }).then(
      () => undefined,
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(McpError);
    expect(err).toMatchObject({ code: ErrorCode.InvalidParams, data: { uri: "pt://catalog/constructor" } });
    expect((err as Error).message).toMatch(/Unknown model "constructor"\. Closest PTBuilder model keys: /);
  });

  it("completes model names for the template", async () => {
    const r = await client.complete({ ref: { type: "ref/resource", uri: "pt://catalog/{model}" }, argument: { name: "model", value: "29" } });
    expect(r.completion.values).toEqual(expect.arrayContaining(["2911", "2960-24TT"]));
  });
});

describe("prompts", () => {
  it("lists the four labs", async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual([...PROMPTS].sort());
    for (const p of prompts) expect(p.description, p.name).toBeTruthy();
  });

  it("completes enumerated arguments", async () => {
    const r = await client.complete({ ref: { type: "ref/prompt", name: "vlan_lab" }, argument: { name: "inter_vlan", value: "l" } });
    expect(r.completion.values).toEqual(["l3-switch"]);
  });

  /** The prompt text embeds the exact build_topology arguments in a ```json block. */
  async function embeddedSpec(name: string, args: Record<string, string>): Promise<{ text: string; spec: Record<string, unknown> }> {
    const r = await client.getPrompt({ name, arguments: args });
    expect(r.messages).toHaveLength(1);
    const content = r.messages[0].content;
    expect(content.type).toBe("text");
    const text = (content as { text: string }).text;
    const m = /```json\n([\s\S]*?)\n```/.exec(text);
    expect(m, `${name}: no json block`).not.toBeNull();
    return { text, spec: JSON.parse(m![1]) as Record<string, unknown> };
  }

  const LABS: [string, Record<string, string>][] = [
    ["vlan_lab", {}],
    ["vlan_lab", { vlans: "10, 20, 300", hosts_per_vlan: "4", inter_vlan: "l3-switch" }],
    ["vlan_lab", { vlans: "5", hosts_per_vlan: "1", inter_vlan: "none" }],
    ["ospf_lab", {}],
    ["ospf_lab", { routers: "6", area: "0.0.0.1", topology: "ring" }],
    ["ospf_lab", { routers: "2", topology: "ring" }],
    ["dhcp_lab", {}],
    ["dhcp_lab", { network: "10.20.0.0/28", dhcp_server: "server", hosts: "5" }],
    ["nat_lab", {}],
    ["nat_lab", { nat_type: "static", inside_network: "10.1.1.0/24", outside_network: "198.51.100.0/24" }],
    ["nat_lab", { nat_type: "dynamic" }],
  ];

  it.each(LABS)("%s %j builds, validates without errors and generates a script", async (name, args) => {
    const { spec } = await embeddedSpec(name, args);
    expect(Object.keys(spec)).toEqual(["devices", "links", "ios", "pcs"]);
    const built = await ok("build_topology", spec);
    expect(built.text).toMatch(/^Topology built: /);
    const validation = (await ok("validate_config")).text;
    expect(validation, validation).not.toContain("Errors (");
    const script = (await ok("generate_script")).texts[0];
    const calls = runInPTBuilder(script);
    expect(calls.filter((c) => c[0] === "addDevice")).toHaveLength((spec.devices as unknown[]).length);
    expect(calls.filter((c) => c[0] === "addLink")).toHaveLength((spec.links as unknown[]).length);
  });

  it("reports argument fallbacks in the prompt text", async () => {
    const { text } = await embeddedSpec("ospf_lab", { routers: "12", topology: "mesh" });
    expect(text).toContain("Argument notes (tell the user): routers must be 2-6; using 6.");
    expect(text).toContain('topology "mesh" is not one of chain, ring; using chain.');
  });
});

describe("file tools", () => {
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

  async function buildLab() {
    await ok("build_topology", {
      devices: [{ name: "R1", model: "2911" }, { name: "S1", model: "2960-24TT" }, { name: "PC1", model: "PC-PT" }],
      links: [
        { dev1: "R1", port1: "Gi0/0", dev2: "S1", port2: "Gi0/1" },
        { dev1: "PC1", port1: "Fa0", dev2: "S1", port2: "Fa0/1" },
      ],
      ios: [{ name: "R1", commands: ["hostname R1"] }],
      pcs: [{ name: "PC1", ip: "10.0.0.10/8", gateway: "10.0.0.1" }],
    });
  }

  it("save_topology writes JSON under MCP_TRACER_DIR and refuses to overwrite unless asked", async () => {
    await buildLab();
    const file = path.join(dir, "labs", "lab.json");
    expect((await ok("save_topology", { path: "labs/lab" })).text).toBe(`Saved 3 devices, 2 links, 1 IOS config, 1 host IP config to ${file}.`);
    const saved = JSON.parse(await readFile(file, "utf8"));
    expect(saved).toMatchObject({ format: "mcp-tracer/topology", formatVersion: 1 });

    const again = await call("save_topology", { path: "labs/lab" });
    expect(again.isError).toBe(true);
    expect(again.text).toContain("already exists. Pass overwrite: true");
    await ok("save_topology", { path: "labs/lab", overwrite: true });
  });

  it("load_topology restores a saved topology, replacing the current one", async () => {
    await buildLab();
    const before = JSON.parse((await ok("get_topology")).text);
    await ok("save_topology", { path: path.join(dir, "lab.json") });
    await ok("reset_topology");
    await ok("add_device", { name: "Other", model: "2911" });

    const loaded = await ok("load_topology", { path: "lab" });
    expect(loaded.text).toMatch(/^Loaded 3 devices, 2 links, 1 IOS config, 1 host IP config from .*lab\.json \(saved by mcp-tracer v/);
    expect(loaded.text).toContain("The previous topology was replaced.");
    expect(JSON.parse((await ok("get_topology")).text)).toEqual(before);
  });

  it("load_topology keeps the current topology when the file is bad", async () => {
    await ok("add_device", { name: "KEEP", model: "2911" });
    await writeFile(path.join(dir, "bad.json"), "{ nope");
    const bad = await call("load_topology", { path: "bad.json" });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/Could not load .*bad\.json; the current topology is unchanged\.\nNot valid JSON/);

    await writeFile(path.join(dir, "future.json"), JSON.stringify({ format: "mcp-tracer/topology", formatVersion: 9, topology: {} }));
    expect((await call("load_topology", { path: "future" })).text).toMatch(/newer than this server supports/);
    expect((await call("load_topology", { path: "missing" })).text).toMatch(/File not found: .*missing\.json/);
    expect(JSON.parse((await ok("get_topology")).text).devices.map((d: { name: string }) => d.name)).toEqual(["KEEP"]);
  });

  it("export_script writes the same script as generate_script, with a trailing newline", async () => {
    await buildLab();
    const script = (await ok("generate_script")).texts[0];
    const r = await ok("export_script", { path: "out/lab" });
    const file = path.join(dir, "out", "lab.js");
    expect(r.text).toContain(`Wrote the PTBuilder script (${script.split("\n").length} lines) to ${file}.`);
    expect(await readFile(file, "utf8")).toBe(`${script}\n`);
    expect((await call("export_script", { path: "out/lab" })).isError).toBe(true);
  });

  it("export_script is blocked by validation errors unless forced, and writes nothing", async () => {
    await buildLab();
    await ok("add_link", { dev1: "R1", port1: "Gi0/1", dev2: "S1", port2: "Gi0/2", cable: "fiber" });
    const blocked = await call("export_script", { path: "x" });
    expect(blocked.isError).toBe(true);
    expect(blocked.text).toContain("[CABLE_INCOMPATIBLE]");
    await expect(readFile(path.join(dir, "x.js"), "utf8")).rejects.toThrow();
    const forced = await ok("export_script", { path: "x", force: true });
    expect(forced.text).toContain("Generated with force: true despite these issues:");
  });

  it("file tools write and read only their own extensions, so nothing executable can be produced", async () => {
    await buildLab();
    for (const p of ["run.cmd", "run.BAT", "lab.js", "lab.txt"]) {
      const r = await call("save_topology", { path: p });
      expect(r.isError, p).toBe(true);
      expect(r.text, p).toMatch(/but only \.json files are allowed here/);
    }
    for (const p of ["run.cmd", "run.bat", "run.ps1", "lab.json"]) {
      const r = await call("export_script", { path: p, force: true });
      expect(r.isError, p).toBe(true);
      expect(r.text, p).toMatch(/only \.js and \.txt files are allowed here/);
    }
    expect((await call("load_topology", { path: "run.cmd" })).text).toMatch(/only \.json files are allowed here/);
    expect((await call("save_topology", { path: "~" })).text).toMatch(/names a directory, not a file/);
    expect((await readdir(dir)).sort()).toEqual([]);

    await ok("export_script", { path: "lab.TXT" });
    await ok("save_topology", { path: "lab.Json" });
    expect((await readdir(dir)).sort()).toEqual(["lab.Json", "lab.TXT"]);
    expect(await readFile(path.join(dir, "lab.TXT"), "utf8")).toMatch(/^\/\* Generated by mcp-tracer/);
  });
});
