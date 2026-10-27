import { describe, expect, it } from "vitest";
import {
  CABLE_TYPES, UNVERIFIED_CABLES, cableFitsLink, cableFitsPorts, expectedEthernetCable, inferCable, linkPortsCompatible,
  portKindsCompatible, possiblePortKinds, resolveCable,
} from "../src/cables.js";
import { CATALOG, getModelInfo, type ModelInfo } from "../src/catalog.js";
import { Topology } from "../src/topology.js";
import { validate } from "../src/validate.js";

const infer = (a: string, pa: string, b: string, pb: string) => inferCable(getModelInfo(a), pa, getModelInfo(b), pb);

describe("inferCable: docs/PTBUILDER_API.md §4 matrix", () => {
  it.each([
    ["router <-> switch", "2911", "GigabitEthernet0/0", "2960-24TT", "GigabitEthernet0/1", "straight"],
    ["router <-> multilayer switch", "2911", "GigabitEthernet0/0", "3560-24PS", "GigabitEthernet0/1", "straight"],
    ["switch <-> PC", "2960-24TT", "FastEthernet0/1", "PC-PT", "FastEthernet0", "straight"],
    ["switch <-> server", "2960-24TT", "FastEthernet0/2", "Server-PT", "FastEthernet0", "straight"],
    ["switch <-> printer", "2960-24TT", "FastEthernet0/3", "Printer-PT", "FastEthernet0", "straight"],
    ["hub <-> PC", "Hub-PT", "Port 0", "PC-PT", "FastEthernet0", "straight"],
    ["hub <-> router", "Hub-PT", "Port 0", "1841", "FastEthernet0/0", "straight"],
    ["switch <-> switch", "2960-24TT", "GigabitEthernet0/1", "2960-24TT", "GigabitEthernet0/2", "cross"],
    ["switch <-> multilayer switch", "2960-24TT", "GigabitEthernet0/1", "3560-24PS", "GigabitEthernet0/1", "cross"],
    ["hub <-> hub", "Hub-PT", "Port 0", "Hub-PT", "Port 1", "cross"],
    ["router <-> router", "2911", "GigabitEthernet0/1", "ISR4331", "GigabitEthernet0/0/0", "cross"],
    ["router <-> PC", "2911", "GigabitEthernet0/0", "PC-PT", "FastEthernet0", "cross"],
    ["PC <-> PC", "PC-PT", "FastEthernet0", "PC-PT", "FastEthernet0", "cross"],
    ["PC <-> server", "PC-PT", "FastEthernet0", "Server-PT", "FastEthernet0", "cross"],
    ["AP <-> switch", "AccessPoint-PT", "Port 0", "2960-24TT", "FastEthernet0/1", "straight"],
    ["AP <-> hub", "AccessPoint-PT", "Port 0", "Hub-PT", "Port 1", "straight"],
    ["AP <-> router", "AccessPoint-PT", "Port 0", "2911", "GigabitEthernet0/0", "cross"],
    ["AP <-> PC", "AccessPoint-PT", "Port 0", "PC-PT", "FastEthernet0", "cross"],
    ["wireless router LAN <-> PC", "Linksys-WRT300N", "Ethernet 1", "PC-PT", "FastEthernet0", "straight"],
    ["wireless router Internet <-> switch", "Linksys-WRT300N", "Internet", "2960-24TT", "FastEthernet0/1", "straight"],
    ["wireless router Internet <-> router", "Linksys-WRT300N", "Internet", "2911", "GigabitEthernet0/0", "cross"],
    ["serial", "ISR4331", "Serial0/1/0", "ISR4331", "Serial0/1/1", "serial"],
    ["serial to a cloud", "Cloud-PT", "Serial0", "ISR4321", "Serial0/1/0", "serial"],
    ["console: PC RS232 <-> router Console", "PC-PT", "RS232", "2911", "Console", "console"],
    ["console: switch Console <-> laptop RS232", "2960-24TT", "Console", "Laptop-PT", "RS232", "console"],
    ["console: router Aux <-> PC RS232", "2911", "Aux", "PC-PT", "RS232", "console"],
    ["coaxial", "Cloud-PT", "Coaxial7", "Cloud-PT", "Coaxial7", "coaxial"],
    ["phone", "Cloud-PT", "Modem4", "Cloud-PT", "Modem5", "phone"],
  ])("%s: %s %s <-> %s %s = %s", (_label, a, pa, b, pb, cable) => {
    expect(infer(a, pa, b, pb)).toBe(cable);
    expect(infer(b, pb, a, pa)).toBe(cable);
  });

  it("falls back to straight when a device is uncatalogued", () => {
    expect(inferCable(undefined, "Port 0", getModelInfo("2911"), "GigabitEthernet0/0")).toBe("straight");
    expect(expectedEthernetCable(undefined, "x", getModelInfo("2911"), "GigabitEthernet0/0")).toBeUndefined();
  });

  it("never infers a cable whose behaviour is unverified", () => {
    for (const a of CATALOG) for (const b of CATALOG) {
      const cable = inferCable(a, a.ports[0]?.name ?? "Port 0", b, b.ports[0]?.name ?? "Port 0");
      expect(UNVERIFIED_CABLES.has(cable), `${a.model} <-> ${b.model}`).toBe(false);
    }
  });
});

describe("compatibility helpers", () => {
  it("portKindsCompatible joins like kinds and Console/Aux with RS232 only", () => {
    expect(portKindsCompatible("fastethernet", "gigabitethernet")).toBe(true);
    expect(portKindsCompatible("ethernet", "fastethernet")).toBe(true);
    expect(portKindsCompatible("serial", "serial")).toBe(true);
    expect(portKindsCompatible("console", "rs232")).toBe(true);
    expect(portKindsCompatible("rs232", "aux")).toBe(true);
    expect(portKindsCompatible("console", "console")).toBe(false);
    expect(portKindsCompatible("rs232", "rs232")).toBe(false);
    expect(portKindsCompatible("serial", "fastethernet")).toBe(false);
    expect(portKindsCompatible("fiber", "gigabitethernet")).toBe(false);
    expect(portKindsCompatible("other", "serial")).toBe(true);
    expect(portKindsCompatible("other", "wireless")).toBe(false);
    expect(portKindsCompatible("wireless", "wireless")).toBe(false);
  });

  it("cableFitsPorts matches each cable to its port kinds", () => {
    expect(cableFitsPorts("straight", "gigabitethernet", "fastethernet")).toBe(true);
    expect(cableFitsPorts("straight", "serial", "serial")).toBe(false);
    expect(cableFitsPorts("serial", "serial", "serial")).toBe(true);
    expect(cableFitsPorts("console", "console", "rs232")).toBe(true);
    expect(cableFitsPorts("console", "fastethernet", "rs232")).toBe(false);
    expect(cableFitsPorts("fiber", "fiber", "fiber")).toBe(true);
    expect(cableFitsPorts("phone", "modem", "modem")).toBe(true);
    expect(cableFitsPorts("coaxial", "coaxial", "coaxial")).toBe(true);
    expect(cableFitsPorts("auto", "serial", "console")).toBe(true);
    expect(cableFitsPorts("usb", "fastethernet", "fastethernet")).toBe(false);
    expect(cableFitsPorts("usb", "other", "other")).toBe(true);
  });

  it("treats unlisted Ethernet-family names as possibly fiber", () => {
    expect(possiblePortKinds(getModelInfo("2911"), "Gi0/0")).toEqual(["gigabitethernet"]);
    expect(possiblePortKinds(getModelInfo("Hub-PT"), "Port 3")).toEqual(["ethernet", "fiber"]);
    expect(possiblePortKinds(undefined, "Serial0")).toEqual(["serial"]);
    expect(cableFitsLink("fiber", undefined, "GigabitEthernet1/1", undefined, "GigabitEthernet0/1")).toBe(true);
    expect(cableFitsLink("fiber", getModelInfo("2911"), "GigabitEthernet0/0", undefined, "GigabitEthernet0/1")).toBe(false);
  });

  it("resolveCable prefers the explicit cable, else infers one", () => {
    const t = new Topology();
    t.addDevice({ name: "R1", model: "2911" });
    t.addDevice({ name: "S1", model: "2960-24TT" });
    const inferred = t.addLink({ dev1: "R1", port1: "Gi0/0", dev2: "S1", port2: "Gi0/1" });
    const explicit = t.addLink({ dev1: "R1", port1: "Gi0/1", dev2: "S1", port2: "Gi0/2", cable: "cross" });
    expect(resolveCable(t, inferred)).toBe("straight");
    expect(resolveCable(t, explicit)).toBe("cross");
  });
});

describe("property: inferred cables always pass the compatibility checks", () => {
  /** Up to four catalog ports per model (one per kind first), or a guessed name for models without port data. */
  function samplePorts(info: ModelInfo): string[] {
    if (!info.ports.length) return info.category === "hub" ? ["Port 0"] : ["Ethernet0/0"];
    const byKind = new Map<string, string>();
    for (const p of info.ports) if (!byKind.has(p.kind)) byKind.set(p.kind, p.name);
    const picks = [...byKind.values()];
    for (const p of info.ports) if (picks.length < 4 && !picks.includes(p.name)) picks.push(p.name);
    return picks;
  }

  const cases: { a: ModelInfo; pa: string; b: ModelInfo; pb: string }[] = [];
  for (const a of CATALOG) for (const b of CATALOG) for (const pa of samplePorts(a)) for (const pb of samplePorts(b)) cases.push({ a, pa, b, pb });

  it(`checks ${cases.length} model/port pairs`, () => {
    let compatible = 0;
    for (const { a, pa, b, pb } of cases) {
      const label = `${a.model} ${pa} <-> ${b.model} ${pb}`;
      if (!linkPortsCompatible(a, pa, b, pb)) continue;
      compatible++;
      const cable = inferCable(a, pa, b, pb);
      expect(CABLE_TYPES.includes(cable), label).toBe(true);
      expect(cableFitsLink(cable, a, pa, b, pb), label).toBe(true);
      const expected = expectedEthernetCable(a, pa, b, pb);
      if ((cable === "straight" || cable === "cross") && expected) expect(cable, label).toBe(expected);

      // The same link through the model and validate(): no errors and no cable warnings, with the cable omitted or explicit.
      for (const explicit of [undefined, cable]) {
        const t = new Topology();
        t.addDevice({ name: "A", model: a.model });
        t.addDevice({ name: "B", model: b.model });
        t.addLink({ dev1: "A", port1: pa, dev2: "B", port2: pb, cable: explicit });
        const { errors, warnings } = validate(t);
        expect(errors, label).toEqual([]);
        expect(warnings.filter((w) => w.code.startsWith("CABLE_")), label).toEqual([]);
      }
    }
    expect(compatible).toBeGreaterThan(500);
  });
});
