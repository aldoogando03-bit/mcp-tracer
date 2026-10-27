/**
 * Cable (PTBuilder link type) selection. Pure, no MCP imports. Rules: docs/PTBUILDER_API.md §3-§4.
 */
import { findPort, getModelInfo, portKind, type ModelInfo, type PortKind } from "./catalog.js";
import type { Link, Topology } from "./topology.js";

/**
 * Valid PTBuilder `allLinkTypes` keys exposed to callers. "auto" (PT's AUTO link type) is accepted but its
 * behaviour through createLink is unverified; omit the cable to let the server infer a concrete one instead.
 * "wireless" is not offered: wireless links form by association, not by cable.
 */
export const CABLE_TYPES = [
  "straight", "cross", "roll", "fiber", "serial", "console", "phone", "coaxial", "auto", "octal", "usb", "custom_io",
] as const;
export type CableType = (typeof CABLE_TYPES)[number];

const kindOf = (info: ModelInfo | undefined, port: string): PortKind => findPort(info, port)?.kind ?? portKind(port);

/**
 * Copper Ethernet role: "mdi" (router/host/firewall-like) or "mdix" (switch/hub-like).
 * Access points cable like end devices (straight to switches/hubs, cross to routers/hosts: PT FAQ #27),
 * and a wireless router's Internet port is a WAN port.
 */
function role(info: ModelInfo | undefined, port: string): "mdi" | "mdix" | undefined {
  if (!info) return undefined;
  if (info.model.startsWith("AccessPoint-PT")) return "mdi";
  if (info.category === "wireless" && /^internet$/i.test(port.trim())) return "mdi";
  return info.layer >= 3 ? "mdi" : "mdix";
}

/** Infers the cable for a link from the device models and port types (docs §4). */
export function inferCable(devA: ModelInfo | undefined, portA: string, devB: ModelInfo | undefined, portB: string): CableType {
  const kinds = [kindOf(devA, portA), kindOf(devB, portB)];
  const has = (...k: PortKind[]) => kinds.some((x) => k.includes(x));
  if (has("console", "rs232", "aux")) return "console";
  if (has("serial")) return "serial";
  if (has("fiber")) return "fiber";
  if (has("coaxial")) return "coaxial";
  if (has("modem")) return "phone";
  const a = role(devA, portA);
  const b = role(devB, portB);
  if (!a || !b) return "straight";
  return a === b ? "cross" : "straight";
}

/** The cable the generator will emit for a link: the explicit one, else the inferred one. */
export function resolveCable(t: Topology, link: Link): CableType {
  if (link.cable) return link.cable;
  const a = t.devices.get(link.dev1);
  const b = t.devices.get(link.dev2);
  return inferCable(a && getModelInfo(a.model), link.port1, b && getModelInfo(b.model), link.port2);
}
