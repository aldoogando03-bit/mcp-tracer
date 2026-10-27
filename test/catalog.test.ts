import { describe, expect, it } from "vitest";
import {
  CATALOG, PTBUILDER_MODELS, findPort, formatPorts, getModelInfo, isIosModel, normalizePort, portKind, resolveModel, samePort,
  suggestModels,
} from "../src/catalog.js";

describe("resolveModel", () => {
  it.each([
    ["4331", "ISR4331"],
    ["4321", "ISR4321"],
    ["WRT300N", "Linksys-WRT300N"],
    ["wrt-300n", "Linksys-WRT300N"],
    ["Wireless Router", "Linksys-WRT300N"],
    ["ASA5505", "5505"],
    ["asa 5505", "5505"],
    ["ASA5506-X", "5506-X"],
    ["IP Phone 7960", "7960"],
    ["ip phone", "7960"],
    ["isr4331", "ISR4331"],
    ["ISR 4331", "ISR4331"],
    ["2960", "2960-24TT"],
    ["Catalyst 2960", "2960-24TT"],
    ["catalyst2960", "2960-24TT"],
    ["Cisco 2911", "2911"],
    ["pc", "PC-PT"],
    ["PC-PT", "PC-PT"],
    ["SERVER", "Server-PT"],
    ["laptop", "Laptop-PT"],
    ["3560", "3560-24PS"],
    ["AP", "AccessPoint-PT"],
    ["Cloud", "Cloud-PT"],
  ])("resolves %j to %s", (input, model) => {
    expect(resolveModel(input)?.model).toBe(model);
  });

  it("adds an implied -PT suffix and returns info only for catalogued models", () => {
    expect(resolveModel("Router")).toEqual({ model: "Router-PT", info: undefined });
    expect(resolveModel("switch")?.model).toBe("Switch-PT");
    expect(resolveModel("2911")?.info?.category).toBe("router");
  });

  it.each(["", "   ", "Cisco", "4333", "banana", "-PT"])("does not resolve %j", (input) => {
    expect(resolveModel(input)).toBeUndefined();
  });

  it("resolves every PTBuilder key to itself (no key/alias collisions)", () => {
    for (const m of PTBUILDER_MODELS) expect(resolveModel(m)?.model, m).toBe(m);
  });

  it("resolves every catalog alias to its model, and every catalogued model is a PTBuilder key", () => {
    for (const info of CATALOG) {
      expect(PTBUILDER_MODELS.has(info.model), info.model).toBe(true);
      for (const alias of info.aliases) expect(resolveModel(alias)?.model, alias).toBe(info.model);
    }
  });
});

describe("catalog data", () => {
  it("has unique, normalized port names per model and a known category", () => {
    for (const info of CATALOG) {
      const names = info.ports.map((p) => p.name);
      expect(new Set(names).size, info.model).toBe(names.length);
      for (const p of info.ports) {
        expect(findPort(info, p.name), `${info.model} ${p.name}`).toBe(p);
        expect(portKind(p.name), `${info.model} ${p.name}`).toBe(p.kind);
      }
    }
  });

  it("marks only routers and (multilayer) switches as IOS devices, and only hosts as configurePcIp targets", () => {
    for (const info of CATALOG) {
      expect(info.ios, info.model).toBe(["router", "switch", "l3switch"].includes(info.category));
      expect(info.ios, info.model).toBe(isIosModel(info.model));
      expect(info.pcIp, info.model).toBe(info.category === "host");
      if (info.pcIp) expect(findPort(info, "FastEthernet0"), info.model).toBeDefined();
    }
  });

  it("verifies FastEthernet0 on PC-PT and Server-PT only", () => {
    const verified = CATALOG.filter((m) => m.pcIp && findPort(m, "FastEthernet0")?.verified).map((m) => m.model);
    expect(verified).toEqual(["PC-PT", "Server-PT"]);
  });

  it("synthesizes info for uncatalogued IOS keys and nothing for other uncatalogued keys", () => {
    expect(getModelInfo("Router-PT")).toMatchObject({ category: "router", layer: 3, ios: true, ports: [], portsVerified: "unknown" });
    expect(getModelInfo("Switch-PT")).toMatchObject({ category: "switch", layer: 2, ios: true });
    expect(getModelInfo("IE-2000")).toMatchObject({ category: "l3switch", ios: true });
    expect(getModelInfo("Light")).toBeUndefined();
    expect(getModelInfo("4331")).toBeUndefined();
    expect(isIosModel("PC-PT")).toBe(false);
  });
});

describe("suggestModels", () => {
  it("suggests close keys, catalogued first", () => {
    expect(suggestModels("2912")[0]).toBe("2911");
    expect(suggestModels("2960-48")).toContain("2960-24TT");
    expect(suggestModels("PC", 3)).toHaveLength(3);
    expect(suggestModels("PC")[0]).toBe("PC-PT");
  });
});

describe("normalizePort", () => {
  it.each([
    ["Gi0/0", "GigabitEthernet0/0"],
    ["gi0/0", "GigabitEthernet0/0"],
    ["g0/0/0", "GigabitEthernet0/0/0"],
    ["GigabitEthernet 0/1", "GigabitEthernet0/1"],
    ["gigabitethernet0/1", "GigabitEthernet0/1"],
    ["  Gi0/1  ", "GigabitEthernet0/1"],
    ["Gi0/0.10", "GigabitEthernet0/0.10"],
    ["fa0/1", "FastEthernet0/1"],
    ["FA 0/1", "FastEthernet0/1"],
    ["f0", "FastEthernet0"],
    ["FastEthernet0", "FastEthernet0"],
    ["te1/1", "TenGigabitEthernet1/1"],
    ["eth1", "Ethernet1"],
    ["Ethernet 1", "Ethernet1"],
    ["se0/0/0", "Serial0/0/0"],
    ["Serial2/0", "Serial2/0"],
    ["con", "Console"],
    ["con0", "Console"],
    ["console", "Console"],
    ["Aux0", "Aux"],
    ["rs 232", "RS232"],
    ["Rs232", "RS232"],
    ["rs-232", "RS232"],
    ["Port 0", "Port 0"],
    ["port0", "Port 0"],
    ["Internet", "Internet"],
    ["mod4", "Modem4"],
    ["coax7", "Coaxial7"],
    ["Wireless0", "Wireless0"],
    ["lo0", "Loopback0"],
    ["vl10", "Vlan10"],
    ["Vlan1", "Vlan1"],
    ["po1", "Port-channel1"],
    ["Port-channel1", "Port-channel1"],
    ["foo 1", "foo1"],
    ['weird "name"', 'weird "name"'],
  ])("normalizes %j to %j", (input, expected) => {
    expect(normalizePort(input)).toBe(expected);
  });

  it("is idempotent on its own output", () => {
    for (const p of ["Gi0/0", "fa0/1", "con", "rs 232", "port0", "eth1", "se0/0/0", "Internet"]) {
      expect(normalizePort(normalizePort(p))).toBe(normalizePort(p));
    }
  });
});

describe("port helpers", () => {
  it("samePort ignores case, spaces and abbreviations", () => {
    expect(samePort("Gi0/1", "GigabitEthernet0/1")).toBe(true);
    expect(samePort("ethernet 1", "Ethernet1")).toBe(true);
    expect(samePort("Gi0/1", "Gi0/2")).toBe(false);
    expect(samePort("Fa0/1", "Gi0/1")).toBe(false);
  });

  it("findPort returns the catalog entry for any spelling", () => {
    const wrt = getModelInfo("Linksys-WRT300N");
    expect(findPort(wrt, "eth 2")?.name).toBe("Ethernet 2");
    expect(findPort(getModelInfo("2911"), "gi0/2")).toEqual({ name: "GigabitEthernet0/2", kind: "gigabitethernet", verified: false });
    expect(findPort(getModelInfo("2911"), "Gi0/0")?.verified).toBe(true);
    expect(findPort(undefined, "Gi0/0")).toBeUndefined();
  });

  it("formatPorts compresses consecutive ranges", () => {
    expect(formatPorts(getModelInfo("2960-24TT")!.ports)).toBe("FastEthernet0/1-24, GigabitEthernet0/1-2, Console");
    expect(formatPorts(getModelInfo("Linksys-WRT300N")!.ports)).toBe("Internet, Ethernet 1-4");
    expect(formatPorts([])).toBe("");
  });

  it.each([
    ["GigabitEthernet0/0", "gigabitethernet"],
    ["Fa0/1", "fastethernet"],
    ["Ethernet6", "ethernet"],
    ["Port 0", "ethernet"],
    ["Internet", "ethernet"],
    ["Serial0/0/0", "serial"],
    ["Console", "console"],
    ["RS232", "rs232"],
    ["Aux", "aux"],
    ["Modem4", "modem"],
    ["Coaxial7", "coaxial"],
    ["Wireless0", "wireless"],
    ["Vlan1", "other"],
  ])("portKind(%j) is %s", (name, kind) => {
    expect(portKind(name)).toBe(kind);
  });
});
