/** Device placement on PT's logical workspace. Pure, no MCP imports. */
import { getModelInfo, type Category } from "./catalog.js";
import type { Device, Topology } from "./topology.js";

export type Position = { x: number; y: number };

const ORIGIN_X = 100;
const ORIGIN_Y = 100;
/** Horizontal distance between devices in a row, and vertical distance between rows. */
const DX = 150;
const DY = 150;
/** Auto-placed devices keep at least this distance (per axis) from every other device, moving right if needed. */
const CLEARANCE = 60;
/** Alternating top-down / bottom-up barycenter passes. */
const PASSES = 2;

/**
 * Layout rows, top to bottom. A device goes in the first row matching its catalog category or its model key;
 * anything else (hosts, phones, printers, IoE devices) goes in the last row.
 */
const ROWS: { categories: Category[]; models?: RegExp }[] = [
  { categories: ["cloud", "firewall", "router"], models: /^(Cloud-PT|Cell-Tower|Central-Office-Server|DSL-Modem-PT|Cable-Modem-PT|Meraki-MX65W)/ },
  { categories: ["l3switch"] },
  {
    categories: ["switch", "hub", "wireless"],
    models: /^(Bridge-PT|Repeater-PT|CoAxialSplitter-PT|AccessPoint-PT|HomeRouter-PT|WLC-|LAP-PT|3702i|Copper |Fiber |Power Distribution)/,
  },
  { categories: ["host", "phone"] },
];

/** Row index (0 = top) for a model key. */
export function layoutRow(model: string): number {
  const category = getModelInfo(model)?.category;
  const i = ROWS.findIndex((r) => (category !== undefined && r.categories.includes(category)) || r.models?.test(model));
  return i < 0 ? ROWS.length - 1 : i;
}

const isFixed = (d: Device): d is Device & Position => d.x !== undefined && d.y !== undefined;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Places devices, in the given order, as close as possible to their desired x while keeping `gap` between
 * neighbours: overlapping devices merge into blocks centred on their mean desired x (pool-adjacent-violators).
 */
function spread(desired: number[], gap: number): number[] {
  const blocks: { first: number; n: number; sum: number }[] = [];
  desired.forEach((d, i) => {
    blocks.push({ first: i, n: 1, sum: d });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1];
      const a = blocks[blocks.length - 2];
      if (a.sum / a.n + a.n * gap <= b.sum / b.n) break;
      a.sum += b.sum - b.n * a.n * gap;
      a.n += b.n;
      blocks.pop();
    }
  });
  const out: number[] = [];
  for (const b of blocks) {
    const start = Math.round(b.sum / b.n);
    for (let k = 0; k < b.n; k++) out.push(start + k * gap);
  }
  return out;
}

/**
 * Returns a position for EVERY device, keyed by device name. Explicit x/y are kept as-is. Devices without
 * coordinates get a layered layout: one row per device group (ROWS), each device under the mean x of its linked
 * devices in the rows above (then parents re-centred over their children), so hosts cluster under their switch.
 * Deterministic: depends only on device and link order.
 */
export function layoutPositions(t: Topology): Map<string, Position> {
  const fixed = new Map<string, Position>();
  const auto: string[] = [];
  for (const d of t.devices.values()) {
    if (isFixed(d)) fixed.set(d.name, { x: d.x, y: d.y });
    else auto.push(d.name);
  }
  if (!auto.length) return fixed;

  const row = new Map([...t.devices.values()].map((d) => [d.name, layoutRow(d.model)]));
  const order = new Map(auto.map((n, i) => [n, i]));
  const neighbours = new Map<string, string[]>([...t.devices.keys()].map((n) => [n, []]));
  for (const l of t.links) {
    if (l.dev1 === l.dev2 || !t.devices.has(l.dev1) || !t.devices.has(l.dev2)) continue;
    for (const [a, b] of [[l.dev1, l.dev2], [l.dev2, l.dev1]]) {
      const list = neighbours.get(a)!;
      if (!list.includes(b)) list.push(b);
    }
  }

  // Row y: rows holding no device collapse; a row with explicitly placed devices aligns to their mean y.
  const rowY: number[] = [];
  let prev: number | undefined;
  ROWS.forEach((_, r) => {
    const members = [...t.devices.values()].filter((d) => row.get(d.name) === r);
    if (!members.length) return;
    const ys = members.filter(isFixed).map((d) => d.y);
    let y = ys.length ? Math.round(mean(ys)) : (prev ?? ORIGIN_Y - DY) + DY;
    if (prev !== undefined) y = Math.max(y, prev + DY);
    rowY[r] = prev = y;
  });

  const rows: string[][] = ROWS.map(() => []);
  for (const n of auto) rows[row.get(n)!].push(n);
  const x = new Map<string, number>();
  const xOf = (n: string) => fixed.get(n)?.x ?? x.get(n);

  const placeRow = (r: number, down: boolean) => {
    const members = rows[r];
    if (!members.length) return;
    const desired = new Map<string, number | undefined>();
    for (const n of members) {
      const xs = neighbours
        .get(n)!
        .filter((m) => (fixed.has(m) && row.get(m) !== r) || (down ? row.get(m)! < r : row.get(m)! > r))
        .map(xOf)
        .filter((v): v is number => v !== undefined);
      desired.set(n, xs.length ? mean(xs) : x.get(n));
    }
    // Devices with nothing to align to yet go right of the others, in insertion order.
    const set = [...desired.values()].filter((v): v is number => v !== undefined);
    let right = set.length ? Math.max(...set) : ORIGIN_X - DX;
    for (const n of members) if (desired.get(n) === undefined) desired.set(n, (right += DX));
    const sorted = [...members].sort(
      (a, b) => desired.get(a)! - desired.get(b)! || (x.get(a) ?? 0) - (x.get(b) ?? 0) || order.get(a)! - order.get(b)!
    );
    spread(sorted.map((n) => desired.get(n)!), DX).forEach((v, i) => x.set(sorted[i], v));
  };

  for (let p = 0; p < PASSES; p++) {
    for (let r = 0; r < ROWS.length; r++) placeRow(r, true);
    for (let r = ROWS.length - 1; r >= 0; r--) placeRow(r, false);
  }

  // Keep the auto-placed block right of the origin (and starting at it when nothing is placed explicitly).
  const minX = Math.min(...x.values());
  const shift = fixed.size ? Math.max(0, ORIGIN_X - minX) : ORIGIN_X - minX;

  const taken = [...fixed.values()];
  const out = new Map(fixed);
  const sequence = [...auto].sort((a, b) => row.get(a)! - row.get(b)! || x.get(a)! - x.get(b)! || order.get(a)! - order.get(b)!);
  for (const n of sequence) {
    const p = { x: x.get(n)! + shift, y: rowY[row.get(n)!] };
    // Each step moves p strictly right of one taken device, so it can hit each one at most once. The cap and the
    // progress check also stop the loop where float precision would not move p (coordinates far outside the limits).
    for (let i = 0; i <= taken.length; i++) {
      const hit = taken.find((q) => Math.abs(q.x - p.x) < CLEARANCE && Math.abs(q.y - p.y) < CLEARANCE);
      if (!hit) break;
      const next = Math.ceil(hit.x) + CLEARANCE;
      if (!(next > p.x)) break;
      p.x = next;
    }
    taken.push(p);
    out.set(n, p);
  }
  return new Map([...t.devices.keys()].map((n) => [n, out.get(n)!]));
}
