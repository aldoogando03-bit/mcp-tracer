/** Device placement on PT's logical workspace. Pure, no MCP imports. */
import type { Topology } from "./topology.js";

export type Position = { x: number; y: number };

const ORIGIN = 100;
const SPACING = 150;

/**
 * Returns a position for EVERY device, keyed by device name. Explicit x/y are kept; devices without
 * coordinates are placed on a simple grid that skips cells already taken by explicit positions.
 */
export function layoutPositions(t: Topology): Map<string, Position> {
  const out = new Map<string, Position>();
  const auto: string[] = [];
  for (const d of t.devices.values()) {
    if (d.x !== undefined && d.y !== undefined) out.set(d.name, { x: d.x, y: d.y });
    else auto.push(d.name);
  }
  const taken = new Set([...out.values()].map((p) => `${Math.round(p.x)},${Math.round(p.y)}`));
  const cols = Math.max(1, Math.ceil(Math.sqrt(t.devices.size)));
  let cell = 0;
  for (const name of auto) {
    let pos: Position;
    do {
      pos = { x: ORIGIN + (cell % cols) * SPACING, y: ORIGIN + Math.floor(cell / cols) * SPACING };
      cell++;
    } while (taken.has(`${pos.x},${pos.y}`));
    out.set(name, pos);
  }
  return out;
}
