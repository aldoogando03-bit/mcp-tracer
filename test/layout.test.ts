import { describe, expect, it } from "vitest";
import { layoutPositions, layoutRow, type Position } from "../src/layout.js";
import { Topology, type DeviceInput, type LinkInput } from "../src/topology.js";

/** Auto-placed devices keep at least this distance on one axis from every other device (layout.ts CLEARANCE). */
const MIN_SPACING = 60;

function build(devices: DeviceInput[], links: LinkInput[] = []): Topology {
  return Topology.fromSpec({ devices, links }).topology;
}

/** Campus-like lab: 2 routers, a multilayer switch, 2 switches, 5 hosts, an AP and a cloud. */
const DEVICES: DeviceInput[] = [
  { name: "PC1", model: "PC-PT" },
  { name: "S1", model: "2960-24TT" },
  { name: "R1", model: "2911" },
  { name: "PC2", model: "PC-PT" },
  { name: "MLS1", model: "3560-24PS" },
  { name: "S2", model: "2960-24TT" },
  { name: "R2", model: "2911" },
  { name: "PC3", model: "PC-PT" },
  { name: "SRV1", model: "Server-PT" },
  { name: "AP1", model: "AccessPoint-PT" },
  { name: "PC4", model: "PC-PT" },
  { name: "NET", model: "Cloud-PT" },
];
const LINKS: LinkInput[] = [
  { dev1: "R1", port1: "Gi0/0", dev2: "MLS1", port2: "Gi0/1" },
  { dev1: "R2", port1: "Gi0/0", dev2: "MLS1", port2: "Gi0/2" },
  { dev1: "R1", port1: "Gi0/1", dev2: "NET", port2: "Ethernet6" },
  { dev1: "MLS1", port1: "Fa0/1", dev2: "S1", port2: "Gi0/1" },
  { dev1: "MLS1", port1: "Fa0/2", dev2: "S2", port2: "Gi0/1" },
  { dev1: "PC1", port1: "Fa0", dev2: "S1", port2: "Fa0/1" },
  { dev1: "PC2", port1: "Fa0", dev2: "S1", port2: "Fa0/2" },
  { dev1: "PC3", port1: "Fa0", dev2: "S2", port2: "Fa0/1" },
  { dev1: "SRV1", port1: "Fa0", dev2: "S2", port2: "Fa0/2" },
  { dev1: "AP1", port1: "Port 0", dev2: "S2", port2: "Fa0/3" },
];

function expectSpacing(t: Topology, pos: Map<string, Position>) {
  const names = [...pos.keys()];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const [a, b] = [t.devices.get(names[i])!, t.devices.get(names[j])!];
      if (a.x !== undefined && b.x !== undefined) continue; // two explicit positions are the user's choice
      const [p, q] = [pos.get(a.name)!, pos.get(b.name)!];
      const gap = Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y));
      expect(gap, `${a.name} (${p.x},${p.y}) vs ${b.name} (${q.x},${q.y})`).toBeGreaterThanOrEqual(MIN_SPACING);
    }
  }
}

describe("layoutRow", () => {
  it.each([
    ["2911", 0],
    ["Router-PT", 0],
    ["Cloud-PT", 0],
    ["5505", 0],
    ["DSL-Modem-PT", 0],
    ["3560-24PS", 1],
    ["IE-2000", 1],
    ["2960-24TT", 2],
    ["Hub-PT", 2],
    ["AccessPoint-PT-N", 2],
    ["Linksys-WRT300N", 2],
    ["WLC-2504", 2],
    ["PC-PT", 3],
    ["7960", 3],
    ["Light", 3],
  ])("puts %s in row %i", (model, row) => {
    expect(layoutRow(model)).toBe(row);
  });
});

describe("layoutPositions", () => {
  it("returns a position for every device, in device order", () => {
    const t = build(DEVICES, LINKS);
    expect([...layoutPositions(t).keys()]).toEqual(DEVICES.map((d) => d.name));
    expect(layoutPositions(new Topology()).size).toBe(0);
  });

  it("gives auto-placed devices integer coordinates at or right of the origin", () => {
    for (const [name, p] of layoutPositions(build(DEVICES, LINKS))) {
      expect(Number.isInteger(p.x), name).toBe(true);
      expect(Number.isInteger(p.y), name).toBe(true);
      expect(p.x, name).toBeGreaterThanOrEqual(100);
      expect(p.y, name).toBeGreaterThanOrEqual(100);
    }
  });

  it("stacks rows: routers/clouds above multilayer switches above switches/APs above hosts", () => {
    const pos = layoutPositions(build(DEVICES, LINKS));
    const y = (n: string) => pos.get(n)!.y;
    expect(y("R1")).toBe(y("R2"));
    expect(y("R1")).toBe(y("NET"));
    expect(y("R1")).toBeLessThan(y("MLS1"));
    expect(y("MLS1")).toBeLessThan(y("S1"));
    expect(y("S1")).toBe(y("S2"));
    expect(y("S1")).toBe(y("AP1"));
    expect(y("S1")).toBeLessThan(y("PC1"));
    for (const h of ["PC1", "PC2", "PC3", "PC4", "SRV1"]) expect(y(h)).toBe(y("PC1"));
    expect(new Set([...pos.values()].map((p) => p.y))).toEqual(new Set([100, 250, 400, 550]));
  });

  it("collapses empty rows", () => {
    const pos = layoutPositions(build([{ name: "R1", model: "2911" }, { name: "PC1", model: "PC-PT" }], [{ dev1: "R1", port1: "Gi0/0", dev2: "PC1", port2: "Fa0" }]));
    expect(pos.get("R1")).toEqual({ x: 100, y: 100 });
    expect(pos.get("PC1")).toEqual({ x: 100, y: 250 });
  });

  it("places hosts under their own switch", () => {
    const pos = layoutPositions(build(DEVICES, LINKS));
    const x = (n: string) => pos.get(n)!.x;
    const mid = (...ns: string[]) => ns.map(x).reduce((a, b) => a + b, 0) / ns.length;
    expect(x("S1")).toBeLessThan(x("S2"));
    expect(Math.max(x("PC1"), x("PC2"))).toBeLessThan(Math.min(x("PC3"), x("SRV1")));
    expect(Math.abs(x("S1") - mid("PC1", "PC2"))).toBeLessThanOrEqual(150);
  });

  it("keeps explicit coordinates exactly, including fractional and negative ones", () => {
    const devices = DEVICES.map((d) =>
      d.name === "R1" ? { ...d, x: 333.5, y: -20 } : d.name === "PC3" ? { ...d, x: 1000, y: 1000 } : d
    );
    const pos = layoutPositions(build(devices, LINKS));
    expect(pos.get("R1")).toEqual({ x: 333.5, y: -20 });
    expect(pos.get("PC3")).toEqual({ x: 1000, y: 1000 });
  });

  it("aligns a row with its explicitly placed members", () => {
    const pos = layoutPositions(build([
      { name: "S1", model: "2960-24TT", x: 500, y: 300 },
      { name: "S2", model: "2960-24TT" },
      { name: "PC1", model: "PC-PT" },
    ], [{ dev1: "PC1", port1: "Fa0", dev2: "S1", port2: "Fa0/1" }]));
    expect(pos.get("S2")!.y).toBe(300);
    expect(pos.get("PC1")!.y).toBe(450);
  });

  it("keeps the minimum spacing between auto-placed devices and every other device", () => {
    const t = build(DEVICES, LINKS);
    expectSpacing(t, layoutPositions(t));

    // Explicit devices dropped right where the auto layout would put things.
    const crowded = build(
      [
        ...DEVICES,
        { name: "X1", model: "PC-PT", x: 100, y: 100 },
        { name: "X2", model: "PC-PT", x: 130, y: 400 },
        { name: "X3", model: "PC-PT", x: 160, y: 410 },
        { name: "X4", model: "2960-24TT", x: 250.7, y: 250 },
      ],
      LINKS
    );
    expectSpacing(crowded, layoutPositions(crowded));
  });

  it("keeps the spacing for many unlinked devices", () => {
    const many = build(Array.from({ length: 40 }, (_, i) => ({ name: `D${i}`, model: ["2911", "2960-24TT", "PC-PT", "3560-24PS"][i % 4] })));
    expectSpacing(many, layoutPositions(many));
  });

  it("is deterministic: same topology, same positions", () => {
    const a = layoutPositions(build(DEVICES, LINKS));
    const b = layoutPositions(build(DEVICES, LINKS));
    expect(b).toEqual(a);
    expect(layoutPositions(build(DEVICES, LINKS))).toEqual(a);
  });

  it("assigns the same rows whatever the insertion order", () => {
    const rowsOf = (devices: DeviceInput[]) => {
      const pos = layoutPositions(build(devices, LINKS));
      return Object.fromEntries([...pos].map(([n, p]) => [n, p.y]));
    };
    const expected = rowsOf(DEVICES);
    const reversed = [...DEVICES].reverse();
    const rotated = [...DEVICES.slice(5), ...DEVICES.slice(0, 5)];
    expect(rowsOf(reversed)).toEqual(expected);
    expect(rowsOf(rotated)).toEqual(expected);
  });

  it("ignores links to missing devices and self-links", () => {
    const t = build([{ name: "S1", model: "2960-24TT" }, { name: "PC1", model: "PC-PT" }]);
    t.links.push({ dev1: "S1", port1: "FastEthernet0/1", dev2: "S1", port2: "FastEthernet0/2" });
    t.links.push({ dev1: "PC1", port1: "FastEthernet0", dev2: "ghost", port2: "x" });
    const pos = layoutPositions(t);
    expect(pos.size).toBe(2);
    expectSpacing(t, pos);
  });
});
