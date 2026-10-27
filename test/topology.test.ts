import { describe, expect, it } from "vitest";
import { LIMITS, Topology, sanitizeIos, type TopologySpec } from "../src/topology.js";

/** R1 (2911), S1 (2960-24TT), PC1 (PC-PT). */
function base(): Topology {
  const t = new Topology();
  t.addDevice({ name: "R1", model: "2911" });
  t.addDevice({ name: "S1", model: "2960-24TT" });
  t.addDevice({ name: "PC1", model: "PC-PT" });
  return t;
}

describe("addDevice", () => {
  it.each([
    ["4331", "ISR4331"],
    ["WRT300N", "Linksys-WRT300N"],
    ["ASA5505", "5505"],
    ["IP Phone 7960", "7960"],
    ["pc", "PC-PT"],
    ["Cisco 2911", "2911"],
    ["catalyst 2960", "2960-24TT"],
    ["router", "Router-PT"],
  ])("resolves the model %j to %s", (input, model) => {
    const t = new Topology();
    expect(t.addDevice({ name: "D", model: input }).model).toBe(model);
    expect(t.devices.get("D")?.model).toBe(model);
  });

  it("trims the name and keeps explicit coordinates", () => {
    const t = new Topology();
    expect(t.addDevice({ name: "  R1 ", model: "2911", x: 10, y: 20 })).toEqual({ name: "R1", model: "2911", x: 10, y: 20 });
    expect(t.addDevice({ name: "R2", model: "2911" })).toEqual({ name: "R2", model: "2911" });
  });

  it("rejects duplicate names case-insensitively", () => {
    const t = base();
    expect(() => t.addDevice({ name: "r1", model: "2911" })).toThrow(/A device named "R1" already exists/);
    expect(t.devices.size).toBe(3);
  });

  it("rejects an unknown model and suggests close keys", () => {
    const t = new Topology();
    expect(() => t.addDevice({ name: "R1", model: "2912" })).toThrow(/Unknown model "2912"\. Closest PTBuilder model keys: .*2911/);
    expect(t.devices.size).toBe(0);
  });

  it("rejects empty names, half-given coordinates and non-finite coordinates", () => {
    const t = new Topology();
    expect(() => t.addDevice({ name: "  ", model: "2911" })).toThrow(/must not be empty/);
    expect(() => t.addDevice({ name: "R1", model: "2911", x: 1 })).toThrow(/both x and y/);
    expect(() => t.addDevice({ name: "R1", model: "2911", x: 1, y: Number.NaN })).toThrow(/finite/);
    expect(() => t.addDevice({ name: "R1", model: "2911", x: Infinity, y: 1 })).toThrow(/finite/);
    expect(t.devices.size).toBe(0);
  });

  it("accepts coordinates in -100000..100000 only", () => {
    const t = new Topology();
    expect(t.addDevice({ name: "A", model: "PC-PT", x: -LIMITS.coord, y: LIMITS.coord })).toMatchObject({ x: -100000, y: 100000 });
    expect(() => t.addDevice({ name: "B", model: "PC-PT", x: 6e17, y: 100 })).toThrow(/Coordinates must be between -100000 and 100000, got 600000000000000000/);
    expect(() => t.addDevice({ name: "B", model: "PC-PT", x: 0, y: -100000.5 })).toThrow(/between -100000 and 100000/);
    expect(t.devices.size).toBe(1);
  });

  it.each([
    "R1", "Core SW (1)", "edge-router.lab_2/A", "9", "x".repeat(64),
  ])("accepts the device name %j", (name) => {
    expect(new Topology().addDevice({ name, model: "2911" }).name).toBe(name);
  });

  it.each([
    'R"1', "a*b", "-R1", "_R1", "(R1)", "R1;", "R1\nR2", "PC x", "R&1", "R1:", "x".repeat(65), "__proto__",
  ])("rejects the device name %j with the rule", (name) => {
    expect(() => new Topology().addDevice({ name, model: "2911" })).toThrow(
      /^Invalid device name ".*": use 1-64 characters: letters, digits, spaces and \. _ \( \) \/ -, starting with a letter or digit/s
    );
  });

  it.each(["constructor", "Prototype", "CONSTRUCTOR"])("rejects the reserved name %j", (name) => {
    const t = new Topology();
    expect(() => t.addDevice({ name, model: "2911" })).toThrow(`"${name}" is a reserved name`);
    t.addDevice({ name: "R1", model: "2911" });
    expect(() => t.renameDevice("R1", name)).toThrow(/is a reserved name/);
    expect(() => Topology.fromJSON({ devices: [{ name, model: "2911" }] })).toThrow(/is a reserved name/);
  });

  it("caps the model length and the device count", () => {
    const t = new Topology();
    expect(() => t.addDevice({ name: "R1", model: "2".repeat(65) })).toThrow(/too long \(at most 64 characters\)/);
    for (let i = 0; i < LIMITS.devices; i++) t.devices.set(`D${i}`, { name: `D${i}`, model: "PC-PT" });
    expect(() => t.addDevice({ name: "R1", model: "2911" })).toThrow(/already has 500 devices, the maximum/);
  });
});

describe("addLink", () => {
  it("normalizes abbreviated, case-insensitive ports and device names", () => {
    const t = base();
    expect(t.addLink({ dev1: "r1", port1: "gi0/0", dev2: "S1", port2: "GI 0/1" })).toEqual({
      dev1: "R1",
      port1: "GigabitEthernet0/0",
      dev2: "S1",
      port2: "GigabitEthernet0/1",
    });
    expect(t.addLink({ dev1: "pc1", port1: "fa0", dev2: "s1", port2: "Fa0/1", cable: "straight" })).toEqual({
      dev1: "PC1",
      port1: "FastEthernet0",
      dev2: "S1",
      port2: "FastEthernet0/1",
      cable: "straight",
    });
  });

  it("returns the catalog spelling of a listed port", () => {
    const t = new Topology();
    t.addDevice({ name: "W1", model: "Linksys-WRT300N" });
    t.addDevice({ name: "PC1", model: "PC-PT" });
    expect(t.addLink({ dev1: "W1", port1: "ethernet1", dev2: "PC1", port2: "FastEthernet0" }).port1).toBe("Ethernet 1");
  });

  it("rejects linking a port to itself", () => {
    const t = base();
    expect(() => t.addLink({ dev1: "R1", port1: "Gi0/0", dev2: "r1", port2: "GigabitEthernet0/0" })).toThrow(/to itself/);
    expect(t.links).toHaveLength(0);
  });

  it("rejects linking two ports of the same device, whatever the case of its name", () => {
    const t = base();
    expect(() => t.addLink({ dev1: "S1", port1: "Fa0/1", dev2: "s1", port2: "Fa0/2" })).toThrow(
      "Cannot link S1:FastEthernet0/1 to S1:FastEthernet0/2: both ends are on S1, and Packet Tracer refuses a cable between two ports of the same device."
    );
    expect(() => Topology.fromJSON({ devices: [{ name: "S1", model: "2960-24TT" }], links: [{ dev1: "S1", port1: "Fa0/1", dev2: "S1", port2: "Fa0/2" }] })).toThrow(/both ends are on S1/);
    expect(t.links).toHaveLength(0);
  });

  it("caps port name length, after expansion", () => {
    const t = new Topology();
    t.addDevice({ name: "H1", model: "Hub-PT" });
    t.addDevice({ name: "H2", model: "Hub-PT" });
    const ok = `p${"x".repeat(63)}`;
    expect(t.addLink({ dev1: "H1", port1: ok, dev2: "H2", port2: "Port 1" }).port1).toBe(ok);
    expect(() => t.addLink({ dev1: "H1", port1: `p${"x".repeat(64)}`, dev2: "H2", port2: "Port 2" })).toThrow(/too long \(at most 64 characters\)/);
    // 64 characters as typed, but "g" expands to GigabitEthernet.
    expect(() => t.addLink({ dev1: "H1", port1: `g${"0".repeat(63)}`, dev2: "H2", port2: "Port 2" })).toThrow(/too long/);
    expect(t.links).toHaveLength(1);
  });

  it("caps the link count, and finds used ports through an index (2000 links stay fast)", () => {
    const t = new Topology();
    t.addDevice({ name: "H1", model: "Hub-PT" });
    t.addDevice({ name: "H2", model: "Hub-PT" });
    const start = performance.now();
    for (let i = 0; i < LIMITS.links; i++) t.addLink({ dev1: "H1", port1: `Port ${i}`, dev2: "h2", port2: `port${i}` });
    expect(performance.now() - start).toBeLessThan(2000);
    expect(t.findLink("h2", "PORT 1999")).toBe(t.links[1999]);
    expect(() => t.addLink({ dev1: "H1", port1: "Port 5000", dev2: "H2", port2: "Port 5000" })).toThrow(/already has 2000 links, the maximum/);
  });

  it("rejects reusing a port, however it is spelled", () => {
    const t = base();
    t.addLink({ dev1: "R1", port1: "Gi0/0", dev2: "S1", port2: "Gi0/1" });
    expect(() => t.addLink({ dev1: "PC1", port1: "Fa0", dev2: "s1", port2: "gigabitethernet0/1" })).toThrow(
      /Port S1:GigabitEthernet0\/1 is already used by the link R1:GigabitEthernet0\/0 <-> S1:GigabitEthernet0\/1/
    );
    expect(t.links).toHaveLength(1);
  });

  it("rejects an unknown port on a model with a trusted port list", () => {
    const t = base();
    expect(() => t.addLink({ dev1: "R1", port1: "Gi0/5", dev2: "S1", port2: "Gi0/1" })).toThrow(
      /R1 \(2911\) has no port "GigabitEthernet0\/5"\. Available ports: GigabitEthernet0\/0-2, Console, Aux/
    );
    expect(() => t.addLink({ dev1: "R1", port1: "Se0/0/0", dev2: "S1", port2: "Gi0/1" })).toThrow(/WIC\/HWIC\/NIM module/);
    expect(t.links).toHaveLength(0);
  });

  it("accepts an unlisted port on a model whose port names are unverified or unknown", () => {
    const t = new Topology();
    t.addDevice({ name: "S1", model: "2950-24" });
    t.addDevice({ name: "H1", model: "Hub-PT" });
    t.addDevice({ name: "R1", model: "Router-PT" });
    expect(t.addLink({ dev1: "S1", port1: "Fa0/30", dev2: "H1", port2: "port 3" })).toMatchObject({ port1: "FastEthernet0/30", port2: "Port 3" });
    expect(t.addLink({ dev1: "R1", port1: "se2/0", dev2: "H1", port2: "Port 4" })).toMatchObject({ port1: "Serial2/0" });
  });

  it("rejects unknown devices and unknown cables", () => {
    const t = base();
    expect(() => t.addLink({ dev1: "R9", port1: "Gi0/0", dev2: "S1", port2: "Gi0/1" })).toThrow(/Unknown device "R9"\. Existing devices: R1, S1, PC1\./);
    // The zod schema rejects bad cables before this, but the model double-checks.
    const cable = "wireless" as unknown as "straight";
    expect(() => t.addLink({ dev1: "R1", port1: "Gi0/0", dev2: "S1", port2: "Gi0/1", cable })).toThrow(/Unknown cable "wireless"/);
    expect(t.links).toHaveLength(0);
  });
});

describe("removeDevice / removeLink", () => {
  it("removes a device with its links, IOS commands and host IP", () => {
    const t = base();
    t.addLink({ dev1: "R1", port1: "Gi0/0", dev2: "S1", port2: "Gi0/1" });
    t.addLink({ dev1: "PC1", port1: "Fa0", dev2: "S1", port2: "Fa0/1" });
    t.configureIos({ name: "S1", commands: ["hostname S1"] });
    t.configurePc({ name: "PC1", dhcp: true });

    const r = t.removeDevice("s1");
    expect(r.device.name).toBe("S1");
    expect(r.links).toHaveLength(2);
    expect(r.hadConfig).toBe(true);
    expect(r.hadPcIp).toBe(false);
    expect([...t.devices.keys()]).toEqual(["R1", "PC1"]);
    expect(t.links).toEqual([]);
    expect(t.configs.has("S1")).toBe(false);

    expect(t.removeDevice("PC1")).toMatchObject({ links: [], hadConfig: false, hadPcIp: true });
    expect(t.pcIps.size).toBe(0);
    expect(() => t.removeDevice("PC1")).toThrow(/Unknown device "PC1"/);
  });

  it("removes the one link that uses a port, found by any spelling", () => {
    const t = base();
    t.addLink({ dev1: "R1", port1: "Gi0/0", dev2: "S1", port2: "Gi0/1" });
    t.addLink({ dev1: "PC1", port1: "Fa0", dev2: "S1", port2: "Fa0/1" });
    expect(t.removeLink("s1", "gig0/1")).toMatchObject({ dev1: "R1", port2: "GigabitEthernet0/1" });
    expect(t.links).toHaveLength(1);
    expect(() => t.removeLink("R1", "Gi0/0")).toThrow(/No link uses R1:GigabitEthernet0\/0\. R1 has no links\./);
    expect(() => t.removeLink("S1", "Fa0/2")).toThrow(/Links of S1: PC1:FastEthernet0 <-> S1:FastEthernet0\/1/);
  });
});

describe("renameDevice", () => {
  it("renames in place: links, IOS commands and host IP follow, order is kept", () => {
    const t = base();
    t.addLink({ dev1: "R1", port1: "Gi0/0", dev2: "S1", port2: "Gi0/1" });
    t.addLink({ dev1: "PC1", port1: "Fa0", dev2: "S1", port2: "Fa0/1" });
    t.configureIos({ name: "S1", commands: ["hostname S1"] });
    t.configurePc({ name: "PC1", dhcp: true });

    expect(t.renameDevice("s1", "Core")).toEqual({ name: "Core", model: "2960-24TT" });
    expect([...t.devices.keys()]).toEqual(["R1", "Core", "PC1"]);
    expect(t.links.map((l) => [l.dev1, l.dev2])).toEqual([["R1", "Core"], ["PC1", "Core"]]);
    expect(t.configs.get("Core")).toEqual(["hostname S1"]);

    t.renameDevice("PC1", "Host1");
    expect(t.pcIps.get("Host1")).toEqual({ name: "Host1", dhcp: true });
    expect(t.pcIps.has("PC1")).toBe(false);
  });

  it("allows a case-only rename and rejects a collision with another device", () => {
    const t = base();
    expect(t.renameDevice("R1", "r1").name).toBe("r1");
    expect([...t.devices.keys()]).toEqual(["r1", "S1", "PC1"]);
    expect(() => t.renameDevice("r1", "s1")).toThrow(/A device named "S1" already exists/);
    expect(() => t.renameDevice("r1", " ")).toThrow(/must not be empty/);
    expect(() => t.renameDevice("r1", "R*1")).toThrow(/^Invalid device name "R\*1": use 1-64 characters/);
    expect(() => t.renameDevice("r1", "__proto__")).toThrow(/Invalid device name/);
    expect(() => t.renameDevice("nope", "x")).toThrow(/Unknown device "nope"/);
  });
});

describe("configureIos", () => {
  it("rejects devices that do not run IOS, pointing hosts to configure_pc", () => {
    const t = base();
    expect(() => t.configureIos({ name: "PC1", commands: ["hostname x"] })).toThrow(/does not run IOS.*Use configure_pc/);
    t.addDevice({ name: "FW", model: "ASA5505" });
    expect(() => t.configureIos({ name: "FW", commands: ["hostname x"] })).toThrow(/FW \(5505\) does not run IOS/);
    expect(t.configs.size).toBe(0);
  });

  it("accepts synthesized IOS models without port data (Router-PT)", () => {
    const t = new Topology();
    t.addDevice({ name: "R1", model: "Router-PT" });
    expect(t.configureIos({ name: "R1", commands: ["hostname R1"] }).total).toBe(1);
  });

  it("appends by default and replaces with replace: true", () => {
    const t = base();
    t.configureIos({ name: "R1", commands: ["hostname R1"] });
    expect(t.configureIos({ name: "r1", commands: ["ip routing"] })).toMatchObject({ added: ["ip routing"], total: 2 });
    expect(t.configs.get("R1")).toEqual(["hostname R1", "ip routing"]);
    expect(t.configureIos({ name: "R1", commands: ["hostname X"], replace: true }).total).toBe(1);
    expect(t.configs.get("R1")).toEqual(["hostname X"]);
    expect(t.configureIos({ name: "R1", commands: [], replace: true }).total).toBe(0);
    expect(t.configs.has("R1")).toBe(false);
  });

  it("reports dropped lines and rejects a block with nothing left", () => {
    const t = base();
    const r = t.configureIos({ name: "R1", commands: ["enable", "conf t", "hostname R1", "end", "wr mem"] });
    expect(r.added).toEqual(["hostname R1"]);
    expect(r.dropped).toEqual(["enable", "conf t", "end", "wr mem"]);
    expect(() => t.configureIos({ name: "S1", commands: ["enable", "  ", "end"] })).toThrow(/No IOS commands left to add for S1 \(dropped: enable \| end\)/);
    expect(t.configs.has("S1")).toBe(false);
  });

  it("caps line length, lines per call and lines per device", () => {
    const t = base();
    expect(() => t.configureIos({ name: "R1", commands: ["hostname R1", "x".repeat(513)] })).toThrow(/IOS command 2 for R1 is longer than 512 characters/);
    expect(() => t.configureIos({ name: "R1", commands: Array(2001).fill("ip routing") })).toThrow(/Too many IOS commands for R1: 2001 \(at most 2000 per call\)/);
    expect(t.configureIos({ name: "R1", commands: Array(1500).fill("ip routing") }).total).toBe(1500);
    expect(() => t.configureIos({ name: "R1", commands: Array(501).fill("ip routing") })).toThrow(/R1 would have 2001 IOS commands; the limit is 2000 per device/);
    // A line split on embedded newlines counts once per resulting command.
    expect(() => t.configureIos({ name: "R1", commands: Array(300).fill("a\nb") })).toThrow(/would have 2100/);
    expect(t.configureIos({ name: "R1", commands: ["hostname R1"], replace: true }).total).toBe(1);
  });
});

describe("sanitizeIos", () => {
  it.each([
    "en", "ena", "enable", "ENABLE", "conf", "conf t", "config t", "configure terminal", "configure  terminal", "conf term",
    "end", "End", "wr", "write", "wr mem", "write memory", "do wr", "do write memory", "copy run start",
    "copy running-config startup-config", "do copy run start",
  ])("drops %j", (line) => {
    expect(sanitizeIos([line])).toEqual({ commands: [], dropped: [line.trim()] });
  });

  it.each(["enable secret cisco", "enable password x", "exit", "endpoint", "write erase", "configure replace x", "ending"])("keeps %j", (line) => {
    expect(sanitizeIos([line]).commands).toEqual([line]);
  });

  it("splits embedded CRLF / CR / LF, trims and drops blank lines", () => {
    expect(sanitizeIos(["a\r\nb\rc\nd", "  ", "", "  e  "])).toEqual({ commands: ["a", "b", "c", "d", "e"], dropped: [] });
  });
});

describe("configurePc", () => {
  it("rejects devices that are not hosts", () => {
    const t = base();
    expect(() => t.configurePc({ name: "R1", dhcp: true })).toThrow(/R1 \(2911\) is not a host.*use configure_device/);
    expect(t.pcIps.size).toBe(0);
  });

  it("needs both ip and mask for a static configuration", () => {
    const t = base();
    expect(() => t.configurePc({ name: "PC1", ip: "192.168.1.10" })).toThrow(/needs both ip and mask/);
    expect(() => t.configurePc({ name: "PC1", mask: "/24" })).toThrow(/needs both ip and mask/);
    expect(() => t.configurePc({ name: "PC1" })).toThrow(/needs both ip and mask/);
    expect(t.pcIps.size).toBe(0);
  });

  it.each([
    ["/24", "255.255.255.0"],
    ["24", "255.255.255.0"],
    ["/26", "255.255.255.192"],
    ["/0", "0.0.0.0"],
    ["/32", "255.255.255.255"],
    ["255.255.240.0", "255.255.240.0"],
  ])("converts the mask %j to %s", (mask, dotted) => {
    const t = base();
    expect(t.configurePc({ name: "PC1", ip: "10.1.2.3", mask }).pc.mask).toBe(dotted);
  });

  it("accepts ip in CIDR form and checks it against an explicit mask", () => {
    const t = base();
    expect(t.configurePc({ name: "PC1", ip: " 10.0.0.5/8 ", gateway: "10.0.0.1" }).pc).toEqual({
      name: "PC1", dhcp: false, ip: "10.0.0.5", mask: "255.0.0.0", gateway: "10.0.0.1",
    });
    expect(t.configurePc({ name: "PC1", ip: "10.0.0.5/8", mask: "255.0.0.0" }).pc.mask).toBe("255.0.0.0");
    expect(() => t.configurePc({ name: "PC1", ip: "10.0.0.5/8", mask: "/16" })).toThrow(/disagree/);
  });

  it.each([
    [{ ip: "256.1.1.1", mask: "/24" }, /Invalid ip "256\.1\.1\.1"/],
    [{ ip: "10.0.0", mask: "/24" }, /Invalid ip/],
    [{ ip: "10.0.0.1", mask: "/33" }, /Invalid prefix length/],
    [{ ip: "10.0.0.1", mask: "255.0.255.0" }, /contiguous/],
    [{ ip: "10.0.0.1", mask: "banana" }, /Invalid subnet mask/],
    [{ ip: "10.0.0.1", mask: "/8", gateway: "10.0.0.256" }, /Invalid gateway/],
    [{ dhcp: true, dns: "8.8.8" }, /Invalid dns/],
  ])("rejects %j", (fields, message) => {
    const t = base();
    expect(() => t.configurePc({ name: "PC1", ...fields })).toThrow(message);
    expect(t.pcIps.size).toBe(0);
  });

  it("keeps DNS with DHCP, reports ignored static fields and replaces earlier settings", () => {
    const t = base();
    t.configurePc({ name: "PC1", ip: "10.0.0.5", mask: "/8" });
    const r = t.configurePc({ name: "pc1", dhcp: true, ip: "1.1.1.1", mask: "/8", gateway: "", dns: "8.8.8.8" });
    expect(r).toEqual({ pc: { name: "PC1", dhcp: true, dns: "8.8.8.8" }, ignored: ["ip", "mask"] });
    expect(t.pcIps.get("PC1")).toEqual({ name: "PC1", dhcp: true, dns: "8.8.8.8" });
  });

  it("accepts Laptop-PT and Printer-PT", () => {
    const t = new Topology();
    t.addDevice({ name: "L1", model: "Laptop" });
    t.addDevice({ name: "P1", model: "Printer" });
    expect(t.configurePc({ name: "L1", dhcp: true }).pc.dhcp).toBe(true);
    expect(t.configurePc({ name: "P1", ip: "10.0.0.9/8" }).pc.ip).toBe("10.0.0.9");
  });
});

describe("fromSpec", () => {
  const spec: TopologySpec = {
    devices: [
      { name: "R1", model: "2911" },
      { name: "S1", model: "2960" },
      { name: "PC1", model: "PC" },
    ],
    links: [
      { dev1: "R1", port1: "Gi0/0", dev2: "S1", port2: "Gi0/1" },
      { dev1: "PC1", port1: "Fa0", dev2: "S1", port2: "Fa0/1" },
    ],
    ios: [{ name: "R1", commands: ["enable", "hostname R1"] }],
    pcs: [{ name: "PC1", dhcp: true, ip: "1.2.3.4" }],
  };

  it("builds a new topology and reports alias resolutions, dropped lines and ignored fields", () => {
    const { topology, notes } = Topology.fromSpec(spec);
    expect(topology.devices.size).toBe(3);
    expect(topology.links).toHaveLength(2);
    expect(topology.configs.get("R1")).toEqual(["hostname R1"]);
    expect(notes).toEqual([
      'S1: model "2960" resolved to "2960-24TT".',
      'PC1: model "PC" resolved to "PC-PT".',
      "R1: dropped IOS lines: enable.",
      "PC1: DHCP enabled, ignored ip.",
    ]);
  });

  it.each([
    [{ devices: [...spec.devices, { name: "r1", model: "2911" }] }, /^devices\[3\] "r1": A device named "R1" already exists/],
    [{ links: [...spec.links!, { dev1: "R1", port1: "Gi0/0", dev2: "PC1", port2: "Fa0" }] }, /^links\[2\] R1:Gi0\/0 <-> PC1:Fa0: Port R1:GigabitEthernet0\/0 is already used/],
    [{ ios: [{ name: "PC1", commands: ["hostname x"] }] }, /^ios\[0\] "PC1": PC1 \(PC-PT\) does not run IOS/],
    [{ pcs: [{ name: "PC1", ip: "999.0.0.1", mask: "/8" }] }, /^pcs\[0\] "PC1": Invalid ip/],
  ])("throws naming the failing item (%#)", (patch, message) => {
    expect(() => Topology.fromSpec({ ...spec, ...patch })).toThrow(message);
  });

  it("is atomic: a failure leaves an existing topology untouched", () => {
    let current = base();
    const before = current.toJSON();
    const bad: TopologySpec = { ...spec, pcs: [{ name: "R1", dhcp: true }] };
    try {
      current = Topology.fromSpec(bad).topology;
    } catch {
      /* expected */
    }
    expect(current.toJSON()).toEqual(before);
  });
});

describe("toJSON / fromJSON", () => {
  function full(): Topology {
    const t = Topology.fromSpec({
      devices: [
        { name: "R1", model: "2911", x: 10, y: 20 },
        { name: "S1", model: "2960-24TT" },
        { name: "PC1", model: "PC-PT" },
        { name: "PC2", model: "PC-PT", x: 1.5, y: -2 },
      ],
      links: [
        { dev1: "R1", port1: "Gi0/0", dev2: "S1", port2: "Gi0/1", cable: "straight" },
        { dev1: "PC1", port1: "Fa0", dev2: "S1", port2: "Fa0/1" },
        { dev1: "PC2", port1: "Fa0", dev2: "S1", port2: "Fa0/2" },
      ],
      ios: [
        { name: "S1", commands: ["hostname S1"] },
        { name: "R1", commands: ["hostname R1", "interface GigabitEthernet0/0", "ip address 10.0.0.1 255.0.0.0", "exit"] },
      ],
      pcs: [
        { name: "PC1", ip: "10.0.0.10/8", gateway: "10.0.0.1", dns: "10.0.0.53" },
        { name: "PC2", dhcp: true, dns: "10.0.0.53" },
      ],
    }).topology;
    return t;
  }

  it("serializes a stable, versioned shape", () => {
    const j = full().toJSON();
    expect(j.version).toBe(1);
    expect(j.devices[0]).toEqual({ name: "R1", model: "2911", x: 10, y: 20 });
    expect(j.devices[1]).toEqual({ name: "S1", model: "2960-24TT" });
    expect(j.links[1]).toEqual({ dev1: "PC1", port1: "FastEthernet0", dev2: "S1", port2: "FastEthernet0/1" });
    expect(j.configs).toEqual({ S1: ["hostname S1"], R1: ["hostname R1", "interface GigabitEthernet0/0", "ip address 10.0.0.1 255.0.0.0", "exit"] });
    expect(j.pcIps).toEqual([
      { name: "PC1", dhcp: false, ip: "10.0.0.10", mask: "255.0.0.0", gateway: "10.0.0.1", dns: "10.0.0.53" },
      { name: "PC2", dhcp: true, dns: "10.0.0.53" },
    ]);
  });

  it("round-trips through JSON text without changes", () => {
    const t = full();
    const back = Topology.fromJSON(JSON.parse(JSON.stringify(t.toJSON())));
    expect(back.toJSON()).toEqual(t.toJSON());
    expect([...back.devices.keys()]).toEqual([...t.devices.keys()]);
    expect([...back.configs.keys()]).toEqual([...t.configs.keys()]);
  });

  it("returns copies, so mutating the JSON does not touch the topology", () => {
    const t = full();
    const j = t.toJSON();
    j.devices[0].name = "X";
    j.links[0].dev1 = "X";
    j.configs.R1.push("x");
    expect(t.devices.has("R1")).toBe(true);
    expect(t.links[0].dev1).toBe("R1");
    expect(t.configs.get("R1")).toHaveLength(4);
  });

  it("accepts a minimal object and defaults the optional collections", () => {
    const t = Topology.fromJSON({ devices: [{ name: "PC1", model: "PC-PT" }] });
    expect(t.toJSON()).toEqual({ version: 1, devices: [{ name: "PC1", model: "PC-PT" }], links: [], configs: {}, pcIps: [] });
  });

  it.each([
    [null, /Invalid topology data/],
    [{ devices: "x" }, /Invalid topology data/],
    [{ version: 2, devices: [] }, /Invalid topology data/],
    [{ devices: [{ name: "R1", model: "2911", x: 1, y: Infinity }] }, /Invalid topology data/],
    [{ devices: [], links: [{ dev1: "a", port1: "b", dev2: "c", port2: "d", cable: "wireless" }] }, /Invalid topology data/],
    [{ devices: [{ name: "R1", model: "nope" }] }, /devices\[0\] "R1": Unknown model "nope"/],
    [{ devices: [{ name: "R1", model: "2911" }], links: [{ dev1: "R1", port1: "Gi0/9", dev2: "R1", port2: "Gi0/0" }] }, /has no port/],
    [{ devices: [{ name: "PC1", model: "PC-PT" }], configs: { PC1: ["hostname x"] } }, /does not run IOS/],
    [{ devices: [{ name: "R1", model: "2911" }], pcIps: [{ name: "R1", dhcp: true }] }, /is not a host/],
    [{ devices: [{ name: "R1", model: "2911", x: 100_001, y: 0 }] }, /Invalid topology data/],
    [{ devices: [{ name: "x".repeat(65), model: "2911" }] }, /Invalid topology data/],
    [{ devices: [{ name: "a*b", model: "2911" }] }, /devices\[0\] "a\*b": Invalid device name/],
    [{ devices: [], links: [{ dev1: "a", port1: "p".repeat(65), dev2: "c", port2: "d" }] }, /Invalid topology data/],
    [{ devices: [{ name: "R1", model: "2911" }], configs: { R1: ["x".repeat(513)] } }, /Invalid topology data/],
    [{ devices: [{ name: "R1", model: "2911" }], configs: { R1: Array(2001).fill("x") } }, /Invalid topology data/],
    [{ devices: [], pcIps: [{ name: "PC1", dhcp: false, ip: "1".repeat(33) }] }, /Invalid topology data/],
    [{ devices: Array.from({ length: 501 }, (_, i) => ({ name: `D${i}`, model: "PC-PT" })) }, /Invalid topology data/],
  ])("rejects invalid data (%#)", (data, message) => {
    expect(() => Topology.fromJSON(data)).toThrow(message);
  });
});

describe("lookups and reset", () => {
  it("finds devices case-insensitively and links by any port spelling", () => {
    const t = base();
    t.addLink({ dev1: "R1", port1: "Gi0/0", dev2: "S1", port2: "Gi0/1" });
    expect(t.getDevice(" s1 ")?.name).toBe("S1");
    expect(t.getDevice("S2")).toBeUndefined();
    expect(t.findLink("S1", "g0/1")).toBe(t.links[0]);
    expect(t.findLink("S1", "Gi0/2")).toBeUndefined();
    expect(t.findLink("nope", "Gi0/1")).toBeUndefined();
  });

  it("keeps the name and port indexes in step with renames, removals and direct edits", () => {
    const t = base();
    t.addLink({ dev1: "R1", port1: "Gi0/0", dev2: "S1", port2: "Gi0/1" });
    t.renameDevice("s1", "Core");
    expect(t.getDevice("s1")).toBeUndefined();
    expect(t.getDevice("CORE")?.name).toBe("Core");
    expect(t.findLink("core", "gi0/1")).toBe(t.links[0]);
    expect(t.findLink("S1", "gi0/1")).toBeUndefined();
    t.renameDevice("Core", "core");
    expect(t.getDevice("CORE")?.name).toBe("core");

    t.removeLink("R1", "Gi0/0");
    expect(t.findLink("core", "gi0/1")).toBeUndefined();
    t.addLink({ dev1: "PC1", port1: "Fa0", dev2: "core", port2: "Gi0/1" });
    t.removeDevice("pc1");
    expect(t.getDevice("PC1")).toBeUndefined();
    expect(t.findLink("core", "Gi0/1")).toBeUndefined();

    // Direct edits, as validate tests do: a replaced or longer links array is re-indexed.
    t.devices.set("Edge", { name: "Edge", model: "2911" });
    expect(t.getDevice("edge")?.name).toBe("Edge");
    t.links.push({ dev1: "Edge", port1: "GigabitEthernet0/2", dev2: "core", port2: "GigabitEthernet0/2" });
    expect(t.findLink("EDGE", "gi0/2")).toBe(t.links[0]);
    t.links = [];
    expect(t.findLink("EDGE", "gi0/2")).toBeUndefined();

    // Two names that differ only in case (hand-built state): deleting one keeps the other findable.
    t.devices.set("edge", { name: "edge", model: "2911" });
    t.devices.delete("edge");
    expect(t.getDevice("EDGE")?.name).toBe("Edge");
  });

  it("reset clears everything", () => {
    const t = base();
    t.addLink({ dev1: "R1", port1: "Gi0/0", dev2: "S1", port2: "Gi0/1" });
    t.configureIos({ name: "R1", commands: ["hostname R1"] });
    t.configurePc({ name: "PC1", dhcp: true });
    t.reset();
    expect(t.toJSON()).toEqual({ version: 1, devices: [], links: [], configs: {}, pcIps: [] });
  });
});
