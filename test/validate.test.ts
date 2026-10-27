import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Topology, type Device, type Link, type PcIp } from "../src/topology.js";
import { formatValidation, validate, type Issue } from "../src/validate.js";
import { cleanLab } from "./helpers.js";

/** Builds a topology directly, bypassing the mutators, so states they reject can be validated. */
function raw(parts: { devices?: Device[]; links?: Link[]; configs?: Record<string, string[]>; pcIps?: PcIp[] }): Topology {
  const t = new Topology();
  for (const d of parts.devices ?? []) t.devices.set(d.name, d);
  t.links = parts.links ?? [];
  for (const [k, v] of Object.entries(parts.configs ?? {})) t.configs.set(k, v);
  for (const p of parts.pcIps ?? []) t.pcIps.set(p.name, p);
  return t;
}

const codes = (issues: Issue[]) => issues.map((i) => i.code);

/** The issues with `code`, after checking it was reported with the expected severity. */
function issuesWith(t: Topology, code: string, severity: "error" | "warning"): Issue[] {
  const { errors, warnings } = validate(t);
  const mine = severity === "error" ? errors : warnings;
  const other = severity === "error" ? warnings : errors;
  expect(codes(other)).not.toContain(code);
  const found = mine.filter((i) => i.code === code);
  expect(found.length, `expected ${severity} ${code}; got ${JSON.stringify([...errors, ...warnings])}`).toBeGreaterThan(0);
  for (const i of found) expect(i.severity).toBe(severity);
  return found;
}

const pair = (a: string, b: string) => {
  const t = new Topology();
  t.addDevice({ name: "A", model: a });
  t.addDevice({ name: "B", model: b });
  return t;
};

describe("validate: a clean lab", () => {
  it("reports no issues at all", () => {
    expect(validate(cleanLab())).toEqual({ errors: [], warnings: [] });
  });
});

describe("validate: errors", () => {
  it("UNKNOWN_MODEL: a model that is not a PTBuilder key", () => {
    const [i] = issuesWith(raw({ devices: [{ name: "R1", model: "4331" }] }), "UNKNOWN_MODEL", "error");
    expect(i.device).toBe("R1");
    expect(i.message).toMatch(/"4331" is not a PTBuilder model key.*Closest keys: ISR4331/);
  });

  it("UNKNOWN_DEVICE: a link to a missing device, with a case hint", () => {
    const t = raw({
      devices: [{ name: "R1", model: "2911" }],
      links: [{ dev1: "R1", port1: "GigabitEthernet0/0", dev2: "s1", port2: "GigabitEthernet0/1" }],
    });
    const [i] = issuesWith(t, "UNKNOWN_DEVICE", "error");
    expect(i.message).toMatch(/device "s1" does not exist\./);
    t.devices.set("S1", { name: "S1", model: "2960-24TT" });
    expect(issuesWith(t, "UNKNOWN_DEVICE", "error")[0].message).toMatch(/\(did you mean S1\?\)/);
  });

  it("UNKNOWN_DEVICE: IOS commands or host IPs stored for a missing device", () => {
    const t = raw({ configs: { R9: ["hostname R9"] }, pcIps: [{ name: "PC9", dhcp: true }] });
    const found = issuesWith(t, "UNKNOWN_DEVICE", "error");
    expect(found.map((i) => i.device)).toEqual(["R9", "PC9"]);
    expect(found[0].message).toMatch(/configureIosDevice would throw/);
    expect(found[1].message).toMatch(/configurePcIp would throw/);
  });

  it("SELF_LINK: a link between two ports of the same device (addLink rejects it; hand-edited states can hold it)", () => {
    const t = raw({
      devices: [{ name: "S1", model: "2960-24TT" }],
      links: [{ dev1: "S1", port1: "FastEthernet0/1", dev2: "S1", port2: "FastEthernet0/2" }],
    });
    expect(issuesWith(t, "SELF_LINK", "error")[0].message).toMatch(/connects S1 to itself/);
  });

  it("SELF_LINK: a port linked to itself", () => {
    const t = raw({
      devices: [{ name: "S1", model: "2960-24TT" }],
      links: [{ dev1: "S1", port1: "FastEthernet0/1", dev2: "S1", port2: "fa0/1" }],
    });
    expect(issuesWith(t, "SELF_LINK", "error")[0].message).toMatch(/links a port to itself/);
  });

  it("PORT_NOT_FOUND: a port missing from a trusted port list, with a serial hint on routers", () => {
    const t = raw({
      devices: [{ name: "R1", model: "2911" }, { name: "R2", model: "2911" }],
      links: [{ dev1: "R1", port1: "Serial0/0/0", dev2: "R2", port2: "Serial0/0/0" }],
    });
    const found = issuesWith(t, "PORT_NOT_FOUND", "error");
    expect(found.map((i) => i.device)).toEqual(["R1", "R2"]);
    expect(found[0].message).toMatch(/R1 \(2911\) has no port "Serial0\/0\/0".*Available ports: GigabitEthernet0\/0-2, Console, Aux\. Serial ports need/);
  });

  it("PORT_KIND_MISMATCH: RS232 to an Ethernet port", () => {
    const t = pair("PC-PT", "2960-24TT");
    t.addLink({ dev1: "A", port1: "RS232", dev2: "B", port2: "Fa0/1" });
    expect(issuesWith(t, "PORT_KIND_MISMATCH", "error")[0].message).toMatch(/joins a RS232 port to a FastEthernet port.*Use ports of the same kind/);
  });

  it("PORT_KIND_MISMATCH: two console-type ports, and serial to Ethernet, get specific hints", () => {
    const consoles = pair("2911", "2960-24TT");
    consoles.addLink({ dev1: "A", port1: "Console", dev2: "B", port2: "Console" });
    expect(issuesWith(consoles, "PORT_KIND_MISMATCH", "error")[0].message).toMatch(/A console cable joins a PC's RS232 port/);

    const serial = pair("ISR4331", "2960-24TT");
    serial.addLink({ dev1: "A", port1: "Serial0/1/0", dev2: "B", port2: "Gi0/1" });
    expect(issuesWith(serial, "PORT_KIND_MISMATCH", "error")[0].message).toMatch(/Serial ports link only to Serial ports/);
  });

  it("CABLE_INCOMPATIBLE: a serial cable between Ethernet ports", () => {
    const t = pair("2911", "2960-24TT");
    t.addLink({ dev1: "A", port1: "Gi0/0", dev2: "B", port2: "Gi0/1", cable: "serial" });
    expect(issuesWith(t, "CABLE_INCOMPATIBLE", "error")[0].message).toMatch(/a serial cable cannot join GigabitEthernet and GigabitEthernet ports.*\(straight\)/);
  });

  it.each(["constructor", "toString", "bogus"])("CABLE_INCOMPATIBLE: a hand-edited cable %j that is not a cable type", (cable) => {
    const t = raw({
      devices: [{ name: "R1", model: "2911" }, { name: "S1", model: "2960-24TT" }],
      links: [{ dev1: "R1", port1: "GigabitEthernet0/0", dev2: "S1", port2: "GigabitEthernet0/1", cable: cable as Link["cable"] }],
    });
    expect(issuesWith(t, "CABLE_INCOMPATIBLE", "error")[0].message).toContain(`a ${cable} cable cannot join GigabitEthernet and GigabitEthernet ports; it is not a PTBuilder cable type`);
  });

  it("DUPLICATE_PORT: two links on one port", () => {
    const t = raw({
      devices: [
        { name: "S1", model: "2960-24TT" },
        { name: "PC1", model: "PC-PT" },
        { name: "PC2", model: "PC-PT" },
      ],
      links: [
        { dev1: "PC1", port1: "FastEthernet0", dev2: "S1", port2: "FastEthernet0/1" },
        { dev1: "PC2", port1: "FastEthernet0", dev2: "S1", port2: "fa0/1" },
      ],
    });
    const [i] = issuesWith(t, "DUPLICATE_PORT", "error");
    expect(i.device).toBe("S1");
    expect(i.message).toMatch(/S1:FastEthernet0\/1 is used by 2 links/);
  });

  it("IOS_ON_NON_IOS: IOS commands stored for a PC", () => {
    const t = raw({ devices: [{ name: "PC1", model: "PC-PT" }], configs: { PC1: ["hostname PC1"] } });
    expect(issuesWith(t, "IOS_ON_NON_IOS", "error")[0].message).toMatch(/configureIosDevice only works on routers.*configure_pc instead/);
  });

  it("PCIP_ON_NON_HOST: a host IP stored for a router", () => {
    const t = raw({ devices: [{ name: "R1", model: "2911" }], pcIps: [{ name: "R1", dhcp: true }] });
    expect(issuesWith(t, "PCIP_ON_NON_HOST", "error")[0].device).toBe("R1");
  });

  it("INVALID_IP: one issue per bad field", () => {
    const t = raw({
      devices: [{ name: "PC1", model: "PC-PT" }],
      pcIps: [{ name: "PC1", dhcp: false, ip: "300.1.1.1", mask: "255.0.255.0", gateway: "1.2.3", dns: "x" }],
    });
    const found = issuesWith(t, "INVALID_IP", "error");
    expect(found.map((i) => i.message.split(" ")[1])).toEqual(["ip", "mask", "gateway", "dns"]);
  });

  it("INVALID_IP: with DHCP only the DNS server is checked", () => {
    const t = raw({ devices: [{ name: "PC1", model: "PC-PT" }], pcIps: [{ name: "PC1", dhcp: true, ip: "bad", dns: "bad" }] });
    expect(issuesWith(t, "INVALID_IP", "error").map((i) => i.message)).toEqual([expect.stringMatching(/^PC1: dns "bad"/)]);
  });

  it("PCIP_STATIC_INCOMPLETE: a static configuration without a mask", () => {
    const t = raw({ devices: [{ name: "PC1", model: "PC-PT" }], pcIps: [{ name: "PC1", dhcp: false, ip: "10.0.0.1" }] });
    expect(issuesWith(t, "PCIP_STATIC_INCOMPLETE", "error")[0].message).toMatch(/without mask/);
  });
});

describe("validate: warnings", () => {
  it("EMPTY_TOPOLOGY", () => {
    expect(validate(new Topology())).toEqual({ errors: [], warnings: [expect.objectContaining({ code: "EMPTY_TOPOLOGY", severity: "warning" })] });
  });

  it("ISOLATED_DEVICE", () => {
    const t = new Topology();
    t.addDevice({ name: "PC1", model: "PC-PT" });
    expect(validate(t)).toEqual({ errors: [], warnings: [expect.objectContaining({ code: "ISOLATED_DEVICE", device: "PC1" })] });
  });

  it("UNCATALOGUED_MODEL: a valid key without port data, suggesting a catalogued model", () => {
    const t = pair("Router-PT", "Light");
    t.addLink({ dev1: "A", port1: "FastEthernet0/0", dev2: "B", port2: "x" });
    const found = issuesWith(t, "UNCATALOGUED_MODEL", "warning");
    expect(found.map((i) => i.device)).toEqual(["A", "B"]);
    expect(found[0].message).toMatch(/Prefer 2911/);
    expect(validate(t).errors).toEqual([]);
  });

  it("POWER_3650", () => {
    const t = new Topology();
    t.addDevice({ name: "MLS1", model: "3650" });
    expect(issuesWith(t, "POWER_3650", "warning")[0].message).toMatch(/Prefer 3560-24PS/);
  });

  it("SERIAL_NEEDS_MODULE: serial ports on an ISR without a NIM", () => {
    const t = pair("ISR4331", "ISR4321");
    t.addLink({ dev1: "A", port1: "Se0/1/0", dev2: "B", port2: "Se0/1/0" });
    const found = issuesWith(t, "SERIAL_NEEDS_MODULE", "warning");
    expect(found).toHaveLength(2);
    expect(found[0].message).toMatch(/needs a NIM-2T module/);
    expect(validate(t).errors).toEqual([]);
    expect(codes(validate(t).warnings)).not.toContain("UNVERIFIED_PORT");
  });

  it("CABLE_UNVERIFIED: an explicit auto or roll cable", () => {
    for (const cable of ["auto", "roll"] as const) {
      const t = pair("2911", "2960-24TT");
      t.addLink({ dev1: "A", port1: "Gi0/0", dev2: "B", port2: "Gi0/1", cable });
      expect(issuesWith(t, "CABLE_UNVERIFIED", "warning")[0].message).toContain(`"${cable}"`);
    }
  });

  it("CABLE_SUSPICIOUS: cross between a router and a switch, straight between two switches", () => {
    const cross = pair("2911", "2960-24TT");
    cross.addLink({ dev1: "A", port1: "Gi0/0", dev2: "B", port2: "Gi0/1", cable: "cross" });
    expect(issuesWith(cross, "CABLE_SUSPICIOUS", "warning")[0].message).toMatch(/cross cable, but Packet Tracer expects straight/);

    const straight = pair("2960-24TT", "2960-24TT");
    straight.addLink({ dev1: "A", port1: "Gi0/1", dev2: "B", port2: "Gi0/1", cable: "straight" });
    expect(issuesWith(straight, "CABLE_SUSPICIOUS", "warning")[0].message).toMatch(/expects cross/);
  });

  it("UNVERIFIED_PORT: one warning per device listing its unverified ports", () => {
    const t = pair("2911", "2960-24TT");
    t.addLink({ dev1: "A", port1: "Gi0/2", dev2: "B", port2: "Fa0/2" });
    t.addLink({ dev1: "A", port1: "Gi0/0", dev2: "B", port2: "Fa0/3" });
    const found = issuesWith(t, "UNVERIFIED_PORT", "warning");
    expect(found.map((i) => i.device)).toEqual(["A", "B"]);
    expect(found[0].message).toMatch(/port name GigabitEthernet0\/2 is unverified/);
    expect(found[1].message).toMatch(/port names FastEthernet0\/2 and FastEthernet0\/3 are unverified/);
  });

  it("PCIP_UNVERIFIED_PORT: configurePcIp on a Laptop-PT", () => {
    const t = new Topology();
    t.addDevice({ name: "L1", model: "Laptop-PT" });
    t.configurePc({ name: "L1", dhcp: true });
    expect(issuesWith(t, "PCIP_UNVERIFIED_PORT", "warning")[0].device).toBe("L1");
  });

  it("HOST_STATIC_NO_GATEWAY", () => {
    const t = new Topology();
    t.addDevice({ name: "PC1", model: "PC-PT" });
    t.configurePc({ name: "PC1", ip: "192.168.5.20", mask: "/24" });
    expect(issuesWith(t, "HOST_STATIC_NO_GATEWAY", "warning")[0].message).toMatch(/192\.168\.5\.20\/24 .* only 192\.168\.5\.0\/24/);
  });

  it("GATEWAY_NOT_IN_SUBNET", () => {
    const t = new Topology();
    t.addDevice({ name: "PC1", model: "PC-PT" });
    t.configurePc({ name: "PC1", ip: "192.168.1.10/24", gateway: "192.168.2.1" });
    expect(issuesWith(t, "GATEWAY_NOT_IN_SUBNET", "warning")[0].message).toMatch(/gateway 192\.168\.2\.1 is outside its subnet 192\.168\.1\.0\/24/);
  });

  it("DUPLICATE_IP: between hosts, and between a host and a router interface", () => {
    const t = cleanLab();
    t.addDevice({ name: "PC2", model: "PC-PT" });
    t.addLink({ dev1: "PC2", port1: "Fa0", dev2: "S1", port2: "Fa0/2" });
    t.configurePc({ name: "PC2", ip: "192.168.1.1/24", gateway: "192.168.1.1" });
    t.addDevice({ name: "PC3", model: "PC-PT" });
    t.addLink({ dev1: "PC3", port1: "Fa0", dev2: "S1", port2: "Fa0/3" });
    t.configurePc({ name: "PC3", ip: "192.168.1.10/24", gateway: "192.168.1.1" });
    const found = issuesWith(t, "DUPLICATE_IP", "warning");
    expect(found.map((i) => i.message)).toEqual([
      "192.168.1.1 is assigned to R1 GigabitEthernet0/0 and PC2. Every interface needs its own address.",
      "192.168.1.10 is assigned to PC1 and PC3. Every interface needs its own address.",
    ]);
  });

  it("DUPLICATE_IP: the last primary address of an interface wins, secondaries count too", () => {
    const t = cleanLab();
    t.configureIos({
      name: "R1",
      commands: [
        "interface Gi0/1",
        "ip address 192.168.1.10 255.255.255.0",
        "ip address 10.9.9.9 255.0.0.0",
        "ip address 10.1.1.1 255.0.0.0 secondary",
        "exit",
      ],
    });
    expect(codes(validate(t).warnings)).not.toContain("DUPLICATE_IP");
    t.configurePc({ name: "PC1", ip: "10.1.1.1/8", gateway: "10.9.9.9" });
    expect(issuesWith(t, "DUPLICATE_IP", "warning")[0].message).toMatch(/10\.1\.1\.1 is assigned to R1 GigabitEthernet0\/1 and PC1/);
  });
});

describe("validate: robustness", () => {
  it("has a test above for every issue code emitted by src/validate.ts", () => {
    // A new code in validate.ts must get a test here (and be added to this list).
    const tested = {
      error: [
        "UNKNOWN_MODEL", "UNKNOWN_DEVICE", "SELF_LINK", "PORT_NOT_FOUND", "PORT_KIND_MISMATCH", "CABLE_INCOMPATIBLE",
        "DUPLICATE_PORT", "IOS_ON_NON_IOS", "PCIP_ON_NON_HOST", "INVALID_IP", "PCIP_STATIC_INCOMPLETE",
      ],
      warn: [
        "EMPTY_TOPOLOGY", "ISOLATED_DEVICE", "UNCATALOGUED_MODEL", "POWER_3650", "SERIAL_NEEDS_MODULE", "CABLE_UNVERIFIED",
        "CABLE_SUSPICIOUS", "UNVERIFIED_PORT", "PCIP_UNVERIFIED_PORT", "HOST_STATIC_NO_GATEWAY", "GATEWAY_NOT_IN_SUBNET", "DUPLICATE_IP",
      ],
    };
    const source = readFileSync(new URL("../src/validate.ts", import.meta.url), "utf8");
    const emitted = { error: new Set<string>(), warn: new Set<string>() };
    for (const m of source.matchAll(/\b(error|warn)\(\s*"([A-Z][A-Z0-9_]+)"/g)) emitted[m[1] as "error" | "warn"].add(m[2]);
    expect([...emitted.error].sort()).toEqual([...tested.error].sort());
    expect([...emitted.warn].sort()).toEqual([...tested.warn].sort());
  });

  it("does not throw on a thoroughly broken topology", () => {
    const t = raw({
      devices: [
        { name: "X", model: "nope" },
        { name: "PC1", model: "PC-PT" },
      ],
      links: [
        { dev1: "X", port1: "a", dev2: "PC1", port2: "FastEthernet0" },
        { dev1: "ghost", port1: "a", dev2: "ghost", port2: "a" },
      ],
      configs: { PC1: ["x"], X: ["y"], R0: [] },
      pcIps: [{ name: "X", dhcp: false }],
    });
    const { errors } = validate(t);
    expect(codes(errors)).toEqual(expect.arrayContaining(["UNKNOWN_MODEL", "UNKNOWN_DEVICE", "IOS_ON_NON_IOS"]));
  });
});

describe("formatValidation", () => {
  it("says so when there are no issues", () => {
    expect(formatValidation(validate(cleanLab()))).toBe("No issues found.");
  });

  it("lists errors, then warnings, with codes and a closing note", () => {
    const issue = (severity: Issue["severity"], code: string, message: string): Issue => ({ severity, code, message });
    const text = formatValidation({
      errors: [issue("error", "E_ONE", "first"), issue("error", "E_TWO", "second")],
      warnings: [issue("warning", "W_ONE", "third")],
    });
    expect(text).toBe(
      [
        "Errors (2):",
        "- [E_ONE] first",
        "- [E_TWO] second",
        "",
        "Warnings (1):",
        "- [W_ONE] third",
        "",
        "Errors block generate_script (force: true overrides); warnings do not.",
      ].join("\n")
    );
  });

  it("with warnings only, says generate_script will run", () => {
    const text = formatValidation(validate(new Topology()));
    expect(text.split("\n")).toEqual([
      "Warnings (1):",
      expect.stringMatching(/^- \[EMPTY_TOPOLOGY\] /),
      "",
      "No errors: generate_script will run. Warnings point at things that may not work in Packet Tracer.",
    ]);
  });
});
