/**
 * Cable (PTBuilder link type) selection and cable/port compatibility. Pure, no MCP imports.
 * Rules: docs/PTBUILDER_API.md §3-§4.
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

/** Explicit cables whose behaviour through createLink is unverified (docs §3); inferCable never returns these. */
export const UNVERIFIED_CABLES: ReadonlySet<CableType> = new Set<CableType>(["auto", "roll", "octal", "usb", "custom_io"]);

const COPPER: readonly PortKind[] = ["fastethernet", "gigabitethernet", "ethernet"];
const LINE: readonly PortKind[] = ["console", "aux"];

/**
 * Port kinds each cable plugs into (docs §4). A port of kind "other" (unknown) is always accepted.
 * roll/octal/usb/custom_io are best guesses: roll is an RJ-45 rollover, octal ends in console RJ-45 plugs,
 * usb/custom_io only fit IoE devices (Things, MCU-PT, SBC-PT), whose port kinds are unknown here.
 */
export const CABLE_PORT_KINDS: Readonly<Record<CableType, readonly PortKind[] | "any">> = {
  straight: COPPER,
  cross: COPPER,
  roll: [...COPPER, ...LINE, "rs232"],
  fiber: ["fiber"],
  serial: ["serial"],
  console: [...LINE, "rs232"],
  phone: ["modem"],
  coaxial: ["coaxial"],
  auto: "any",
  octal: LINE,
  usb: [],
  custom_io: [],
};

/** Human description of the ports a cable needs, for messages. */
export const CABLE_NEEDS: Readonly<Record<CableType, string>> = {
  straight: "copper Ethernet (FastEthernet/GigabitEthernet/Ethernet)",
  cross: "copper Ethernet (FastEthernet/GigabitEthernet/Ethernet)",
  roll: "copper Ethernet or console",
  fiber: "fiber",
  serial: "Serial",
  console: "a Console/Aux port and a PC RS232",
  phone: "modem",
  coaxial: "coaxial",
  auto: "any",
  octal: "async and Console/Aux",
  usb: "USB (IoE devices)",
  custom_io: "IoE custom I/O",
};

/** True when `cable` can plug into a port of this kind. Never true for a string that is not a CableType. */
export const cableFitsPort = (cable: CableType, kind: PortKind): boolean => {
  if (!Object.hasOwn(CABLE_PORT_KINDS, cable)) return false;
  const kinds = CABLE_PORT_KINDS[cable];
  return kind === "other" || kinds === "any" || kinds.includes(kind);
};

/**
 * True when `cable` fits ports of these kinds (docs §4): serial needs Serial on both ends, console needs
 * Console/Aux/RS232, fiber needs fiber, coaxial needs coaxial, phone needs modem, straight/cross need copper Ethernet.
 * Whether the two kinds can be linked at all is portKindsCompatible's job.
 */
export const cableFitsPorts = (cable: CableType, kindA: PortKind, kindB: PortKind): boolean =>
  cableFitsPort(cable, kindA) && cableFitsPort(cable, kindB);

type PortClass = "copper" | "fiber" | "serial" | "line" | "terminal" | "modem" | "coaxial" | "wireless" | "other";
const CLASS: Record<PortKind, PortClass> = {
  fastethernet: "copper", gigabitethernet: "copper", ethernet: "copper", fiber: "fiber", serial: "serial",
  console: "line", aux: "line", rs232: "terminal", modem: "modem", coaxial: "coaxial", wireless: "wireless", other: "other",
};

/**
 * True when some cable can join ports of these kinds, whatever cable is chosen: copper-copper, fiber-fiber,
 * serial-serial, modem-modem, coaxial-coaxial, Console/Aux-RS232 (docs §4). Wireless ports are never cabled.
 * "other" (unknown kind) is compatible with everything but wireless.
 */
export function portKindsCompatible(kindA: PortKind, kindB: PortKind): boolean {
  const a = CLASS[kindA];
  const b = CLASS[kindB];
  if (a === "wireless" || b === "wireless") return false;
  if (a === "other" || b === "other") return true;
  if (a === "line" || a === "terminal") return (a === "line" && b === "terminal") || (a === "terminal" && b === "line");
  return a === b;
}

/**
 * Kinds a link end may have, most likely first: the catalog kind when the port is listed, else the kind guessed
 * from the name. Unlisted Ethernet-family names may also be fiber (fiber ports are named FastEthernet or
 * GigabitEthernet too), so "fiber" is added for them.
 */
export function possiblePortKinds(info: ModelInfo | undefined, port: string): PortKind[] {
  const listed = findPort(info, port);
  if (listed) return [listed.kind];
  const kind = portKind(port);
  return COPPER.includes(kind) ? [kind, "fiber"] : [kind];
}

const anyPair = (a: PortKind[], b: PortKind[], ok: (x: PortKind, y: PortKind) => boolean) => a.some((x) => b.some((y) => ok(x, y)));

/** portKindsCompatible for two link ends (catalog kinds, or name-based guesses for unlisted ports). */
export const linkPortsCompatible = (devA: ModelInfo | undefined, portA: string, devB: ModelInfo | undefined, portB: string) =>
  anyPair(possiblePortKinds(devA, portA), possiblePortKinds(devB, portB), portKindsCompatible);

/** cableFitsPorts for two link ends (catalog kinds, or name-based guesses for unlisted ports). */
export const cableFitsLink = (cable: CableType, devA: ModelInfo | undefined, portA: string, devB: ModelInfo | undefined, portB: string) =>
  anyPair(possiblePortKinds(devA, portA), possiblePortKinds(devB, portB), (x, y) => portKindsCompatible(x, y) && cableFitsPorts(cable, x, y));

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

/**
 * The copper Ethernet cable PT expects between two ports (docs §4 matrix): straight between unlike devices
 * (router/host <-> switch/hub, AP <-> switch/hub), cross between like ones (switch-switch, router-router, router-host,
 * host-host, AP <-> router/host). undefined when either device is uncatalogued.
 */
export function expectedEthernetCable(
  devA: ModelInfo | undefined, portA: string, devB: ModelInfo | undefined, portB: string
): "straight" | "cross" | undefined {
  const a = role(devA, portA);
  const b = role(devB, portB);
  if (!a || !b) return undefined;
  return a === b ? "cross" : "straight";
}

/**
 * Infers the cable for a link from the device models and port kinds (docs §4). For ports whose kinds are
 * compatible, the result always passes cableFitsLink and, for copper, matches expectedEthernetCable.
 */
export function inferCable(devA: ModelInfo | undefined, portA: string, devB: ModelInfo | undefined, portB: string): CableType {
  const kinds = [possiblePortKinds(devA, portA)[0], possiblePortKinds(devB, portB)[0]];
  const has = (...k: PortKind[]) => kinds.some((x) => k.includes(x));
  if (has("console", "rs232", "aux")) return "console";
  if (has("serial")) return "serial";
  if (has("fiber")) return "fiber";
  if (has("coaxial")) return "coaxial";
  if (has("modem")) return "phone";
  return expectedEthernetCable(devA, portA, devB, portB) ?? "straight";
}

/** The cable the generator will emit for a link: the explicit one, else the inferred one. */
export function resolveCable(t: Topology, link: Link): CableType {
  if (link.cable) return link.cable;
  const a = t.devices.get(link.dev1);
  const b = t.devices.get(link.dev2);
  return inferCable(a && getModelInfo(a.model), link.port1, b && getModelInfo(b.model), link.port2);
}
