/**
 * In-memory topology model. Pure, no MCP imports. Mutators validate their input and throw `Error`
 * with an English message meant for the calling agent.
 */
import { z } from "zod";
import { CABLE_TYPES, type CableType } from "./cables.js";
import {
  MAX_PORT_LENGTH, findPort, formatPorts, getModelInfo, normalizePort, portKey, resolveModel, samePort, suggestModels,
} from "./catalog.js";
import { IPV4, ipToInt, maskToPrefix, prefixToMask } from "./ipv4.js";

/**
 * Input size limits, shared by the tool schemas, the file format and the mutators (so whatever the mutators accept
 * can be saved and loaded back). Lengths are in characters; coord bounds |x| and |y|.
 */
export const LIMITS = {
  name: 64, model: 64, port: MAX_PORT_LENGTH, iosLine: 512, iosLines: 2000, ip: 32, path: 1024,
  devices: 500, links: 2000, coord: 100_000,
} as const;

/** Device names: 1-64 characters from letters, digits, space and . _ ( ) / -, starting with a letter or digit. */
export const DEVICE_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._()/-]{0,63}$/;
export const DEVICE_NAME_RULE = "1-64 characters: letters, digits, spaces and . _ ( ) / -, starting with a letter or digit";
/** Names that would collide with JavaScript object internals; denied case-insensitively. */
const RESERVED_NAMES = new Set(["__proto__", "constructor", "prototype"]);

/** `model` is always an exact PTBuilder key. x/y are both set or both omitted (omitted = auto layout). */
export type Device = { name: string; model: string; x?: number; y?: number };
/** Device names are the exact stored names; ports are normalized. `cable` undefined = infer at generation. */
export type Link = { dev1: string; port1: string; dev2: string; port2: string; cable?: CableType };
export type PcIp = { name: string; dhcp: boolean; ip?: string; mask?: string; gateway?: string; dns?: string };

export type DeviceInput = { name: string; model: string; x?: number; y?: number };
export type LinkInput = { dev1: string; port1: string; dev2: string; port2: string; cable?: CableType };
export type IosInput = { name: string; commands: string[]; replace?: boolean };
export type PcInput = { name: string; dhcp?: boolean; ip?: string; mask?: string; gateway?: string; dns?: string };
export type TopologySpec = { devices: DeviceInput[]; links?: LinkInput[]; ios?: IosInput[]; pcs?: PcInput[] };

export type IosResult = { device: Device; added: string[]; dropped: string[]; total: number };
export type PcResult = { pc: PcIp; ignored: string[] };

const str = (max: number) => z.string().max(max);
const coord = z.number().min(-LIMITS.coord).max(LIMITS.coord).optional();

/** Stable serialized shape (toJSON / fromJSON), with the same limits as the tools. */
export const topologyJsonSchema = z.object({
  version: z.literal(1).optional(),
  devices: z.array(z.object({ name: str(LIMITS.name), model: str(LIMITS.model), x: coord, y: coord })).max(LIMITS.devices),
  links: z
    .array(
      z.object({
        dev1: str(LIMITS.name),
        port1: str(LIMITS.port),
        dev2: str(LIMITS.name),
        port2: str(LIMITS.port),
        cable: z.enum(CABLE_TYPES).optional(),
      })
    )
    .max(LIMITS.links)
    .default([]),
  configs: z.record(str(LIMITS.name), z.array(str(LIMITS.iosLine)).max(LIMITS.iosLines)).default({}),
  pcIps: z
    .array(
      z.object({
        name: str(LIMITS.name),
        dhcp: z.boolean(),
        ip: str(LIMITS.ip).optional(),
        mask: str(LIMITS.ip).optional(),
        gateway: str(LIMITS.ip).optional(),
        dns: str(LIMITS.ip).optional(),
      })
    )
    .max(LIMITS.devices)
    .default([]),
});
export type TopologyJSON = { version: 1; devices: Device[]; links: Link[]; configs: Record<string, string[]>; pcIps: PcIp[] };

export const fmtLink = (l: Link) => `${l.dev1}:${l.port1} <-> ${l.dev2}:${l.port2}`;

/** Long user input shortened for error messages. */
const clip = (s: string) => (s.length > LIMITS.name + 16 ? `${s.slice(0, LIMITS.name)}...` : s);

/** Checks a (trimmed) device name against DEVICE_NAME and the reserved names. */
function checkName(name: string, what: string): string {
  if (!name) throw new Error(`${what} must not be empty.`);
  if (!DEVICE_NAME.test(name)) throw new Error(`Invalid device name "${clip(name)}": use ${DEVICE_NAME_RULE} (e.g. R1, S1, PC1).`);
  if (RESERVED_NAMES.has(name.toLowerCase())) throw new Error(`"${name}" is a reserved name; pick another device name.`);
  return name;
}

function checkIp(value: string, field: string): string {
  const v = value.trim();
  if (!IPV4.test(v)) throw new Error(`Invalid ${field} "${clip(value)}": expected a dotted-quad IPv4 address such as 192.168.1.10.`);
  return v;
}

/** Accepts a dotted mask (255.255.255.0) or a prefix length (/24 or 24); returns the dotted mask. */
function toMask(value: string): string {
  const v = value.trim();
  const prefix = /^\/?(\d{1,2})$/.exec(v);
  if (prefix) {
    const n = Number(prefix[1]);
    if (n > 32) throw new Error(`Invalid prefix length "${value}": must be 0-32.`);
    return prefixToMask(n);
  }
  if (!IPV4.test(v)) throw new Error(`Invalid subnet mask "${clip(value)}": use 255.255.255.0 or /24.`);
  if (maskToPrefix(ipToInt(v)) === undefined) throw new Error(`Invalid subnet mask "${value}": the 1-bits must be contiguous.`);
  return v;
}

function checkCoords(x: number | undefined, y: number | undefined) {
  if ((x === undefined) !== (y === undefined)) throw new Error("Give both x and y, or neither (auto layout).");
  for (const v of [x, y]) {
    if (v === undefined) continue;
    if (!Number.isFinite(v)) throw new Error(`Coordinates must be finite numbers, got ${v}.`);
    if (Math.abs(v) > LIMITS.coord) throw new Error(`Coordinates must be between -${LIMITS.coord} and ${LIMITS.coord}, got ${v}.`);
  }
}

/** A Map of devices by exact name that also indexes them by lowercased name, so case-insensitive lookups don't scan. */
class DeviceMap extends Map<string, Device> {
  private lower = new Map<string, string>();

  set(name: string, device: Device): this {
    super.set(name, device);
    this.lower.set(name.toLowerCase(), name);
    return this;
  }

  delete(name: string): boolean {
    if (!super.delete(name)) return false;
    const k = name.toLowerCase();
    if (this.lower.get(k) === name) {
      this.lower.delete(k);
      // Only hand-built topologies can hold two names that differ in case; keep the other one findable.
      for (const n of this.keys()) if (n.toLowerCase() === k) this.lower.set(k, n);
    }
    return true;
  }

  clear(): void {
    super.clear();
    this.lower.clear();
  }

  /** Case-insensitive lookup. */
  find(name: string): Device | undefined {
    const exact = this.lower.get(name.toLowerCase());
    return exact === undefined ? undefined : this.get(exact);
  }
}

/** findLink index key: exact device name plus port comparison key. */
const endKey = (device: string, port: string) => `${device}\u0000${portKey(port)}`;

const DROP_IOS: [RegExp, string][] = [
  [/^en(a(b(le?)?)?)?$/, "enable"],
  [/^conf(i(g(u(r(e)?)?)?)?)?( t(e(r(m(i(n(a(l)?)?)?)?)?)?)?)?$/, "configure terminal"],
  [/^end$/, "end"],
  [/^(do )?wr(i(te?)?)?( mem(o(r(y)?)?)?)?$/, "write memory"],
  [/^(do )?copy run(ning-config)? start(up-config)?$/, "copy running-config startup-config"],
];

/**
 * Cleans IOS commands for configureIosDevice, which starts in global config mode and saves on its own:
 * splits embedded newlines, strips CRs, trims, drops blank lines and enable / configure terminal / end /
 * write memory / copy run start. Returns the kept commands and the dropped lines.
 */
export function sanitizeIos(input: string[]): { commands: string[]; dropped: string[] } {
  const commands: string[] = [];
  const dropped: string[] = [];
  for (const raw of input.flatMap((c) => c.split(/\r\n|\r|\n/))) {
    const line = raw.trim();
    if (!line) continue;
    const norm = line.toLowerCase().replace(/\s+/g, " ");
    if (DROP_IOS.some(([re]) => re.test(norm))) dropped.push(line);
    else commands.push(line);
  }
  return { commands, dropped };
}

export class Topology {
  /** Keyed by exact device name. Lookups from user input should go through getDevice (case-insensitive). */
  devices = new DeviceMap();
  /** Change through the mutators. Direct edits are seen by findLink only when the array is replaced or its length changes. */
  links: Link[] = [];
  /** IOS commands per device name, already sanitized. */
  configs = new Map<string, string[]>();
  pcIps = new Map<string, PcIp>();
  /** findLink's index of `links` by endKey; rebuilt when `links` is replaced or changes length behind addLink's back. */
  private ends?: { links: Link[]; length: number; map: Map<string, Link> };

  reset() {
    this.devices.clear();
    this.links = [];
    this.configs.clear();
    this.pcIps.clear();
  }

  /** Case-insensitive device lookup. */
  getDevice(name: string): Device | undefined {
    const n = name.trim();
    return this.devices.get(n) ?? this.devices.find(n);
  }

  requireDevice(name: string): Device {
    const d = this.getDevice(name);
    if (d) return d;
    const names = [...this.devices.keys()];
    throw new Error(`Unknown device "${clip(name)}". ${names.length ? `Existing devices: ${names.join(", ")}.` : "The topology is empty."}`);
  }

  private endIndex(): Map<string, Link> {
    const e = this.ends;
    if (e && e.links === this.links && e.length === this.links.length) return e.map;
    const map = new Map<string, Link>();
    for (const l of this.links) {
      for (const k of [endKey(l.dev1, l.port1), endKey(l.dev2, l.port2)]) if (!map.has(k)) map.set(k, l);
    }
    this.ends = { links: this.links, length: this.links.length, map };
    return map;
  }

  /** The link using device:port, if any. */
  findLink(device: string, port: string): Link | undefined {
    const d = this.getDevice(device);
    return d && this.endIndex().get(endKey(d.name, port));
  }

  addDevice(input: DeviceInput): Device {
    const name = checkName(input.name.trim(), "Device name");
    const clash = this.getDevice(name);
    if (clash) {
      throw new Error(`A device named "${clash.name}" already exists (names are case-insensitive). Pick another name or use remove_device / rename_device.`);
    }
    if (this.devices.size >= LIMITS.devices) throw new Error(`The topology already has ${LIMITS.devices} devices, the maximum.`);
    if (input.model.length > LIMITS.model) throw new Error(`Model "${clip(input.model)}" is too long (at most ${LIMITS.model} characters).`);
    const resolved = resolveModel(input.model);
    if (!resolved) {
      throw new Error(
        `Unknown model "${input.model}". Closest PTBuilder model keys: ${suggestModels(input.model).join(", ")}. ` +
          "See the pt://catalog resource for every accepted model."
      );
    }
    checkCoords(input.x, input.y);
    const device: Device = { name, model: resolved.model };
    if (input.x !== undefined && input.y !== undefined) Object.assign(device, { x: input.x, y: input.y });
    this.devices.set(name, device);
    return device;
  }

  /** The port name to store: the catalog's spelling when the model lists the port, else the normalized input. */
  private checkPort(d: Device, port: string): string {
    const normalized = normalizePort(port);
    if (!normalized) throw new Error(`Port name for ${d.name} must not be empty.`);
    if (normalized.length > LIMITS.port) throw new Error(`Port name "${clip(normalized)}" is too long (at most ${LIMITS.port} characters).`);
    const info = getModelInfo(d.model);
    const known = findPort(info, normalized);
    if (known) return known.name;
    if (info && (info.portsVerified === "verified" || info.portsVerified === "partial")) {
      const serial = /^Serial/.test(normalized) && info.category === "router" ? " Serial ports need a WIC/HWIC/NIM module, which this server cannot add yet." : "";
      throw new Error(`${d.name} (${d.model}) has no port "${normalized}". Available ports: ${formatPorts(info.ports)}.${serial}`);
    }
    return normalized;
  }

  addLink(input: LinkInput): Link {
    if (this.links.length >= LIMITS.links) throw new Error(`The topology already has ${LIMITS.links} links, the maximum.`);
    const a = this.requireDevice(input.dev1);
    const b = this.requireDevice(input.dev2);
    const port1 = this.checkPort(a, input.port1);
    const port2 = this.checkPort(b, input.port2);
    if (a === b) {
      throw new Error(
        samePort(port1, port2)
          ? `Cannot link ${a.name}:${port1} to itself.`
          : `Cannot link ${a.name}:${port1} to ${a.name}:${port2}: both ends are on ${a.name}, and Packet Tracer refuses a cable ` +
              "between two ports of the same device. Link to another device."
      );
    }
    const index = this.endIndex();
    for (const [d, p] of [[a, port1], [b, port2]] as const) {
      const used = index.get(endKey(d.name, p));
      if (used) throw new Error(`Port ${d.name}:${p} is already used by the link ${fmtLink(used)}. Use another port or remove_link first.`);
    }
    if (input.cable !== undefined && !CABLE_TYPES.includes(input.cable)) {
      throw new Error(`Unknown cable "${input.cable}". Valid cables: ${CABLE_TYPES.join(", ")}.`);
    }
    const link: Link = { dev1: a.name, port1, dev2: b.name, port2 };
    if (input.cable) link.cable = input.cable;
    this.links.push(link);
    index.set(endKey(a.name, port1), link).set(endKey(b.name, port2), link);
    this.ends!.length = this.links.length;
    return link;
  }

  /** Removes a device together with its links, IOS commands and PC IP configuration. */
  removeDevice(name: string): { device: Device; links: Link[]; hadConfig: boolean; hadPcIp: boolean } {
    const device = this.requireDevice(name);
    const links = this.links.filter((l) => l.dev1 === device.name || l.dev2 === device.name);
    this.links = this.links.filter((l) => !links.includes(l));
    this.devices.delete(device.name);
    const hadConfig = this.configs.delete(device.name);
    const hadPcIp = this.pcIps.delete(device.name);
    return { device, links, hadConfig, hadPcIp };
  }

  /** Removes the link that uses device:port (a port belongs to at most one link). */
  removeLink(device: string, port: string): Link {
    const d = this.requireDevice(device);
    const link = this.findLink(d.name, port);
    if (!link) {
      const own = this.links.filter((l) => l.dev1 === d.name || l.dev2 === d.name);
      throw new Error(
        `No link uses ${d.name}:${normalizePort(port)}. ` +
          (own.length ? `Links of ${d.name}: ${own.map(fmtLink).join("; ")}.` : `${d.name} has no links.`)
      );
    }
    this.links = this.links.filter((l) => l !== link);
    return link;
  }

  /** Renames a device; links, IOS commands and PC IP configuration follow. IOS `hostname` lines are untouched. */
  renameDevice(oldName: string, newName: string): Device {
    const d = this.requireDevice(oldName);
    const name = checkName(newName.trim(), "New device name");
    const clash = this.getDevice(name);
    if (clash && clash !== d) throw new Error(`A device named "${clash.name}" already exists (names are case-insensitive).`);
    if (name === d.name) return d;
    const old = d.name;
    const renamed: Device = { ...d, name };
    const rekey = <V>(m: Map<string, V>, map: (v: V) => V = (v) => v) => {
      const entries = [...m];
      m.clear();
      for (const [k, v] of entries) m.set(k === old ? name : k, k === old ? map(v) : v);
    };
    rekey(this.devices, () => renamed);
    rekey(this.configs);
    rekey(this.pcIps, (p) => ({ ...p, name }));
    for (const l of this.links) {
      if (l.dev1 === old) l.dev1 = name;
      if (l.dev2 === old) l.dev2 = name;
    }
    this.ends = undefined; // the links changed in place
    return renamed;
  }

  /** Sets IOS commands (global config mode) on a router/switch/multilayer switch. Appends unless `replace`. */
  configureIos(input: IosInput): IosResult {
    const device = this.requireDevice(input.name);
    const info = getModelInfo(device.model);
    if (!info?.ios) {
      throw new Error(
        `${device.name} (${device.model}) does not run IOS: configure_device only works on routers, switches and multilayer switches ` +
          `(e.g. 2911, 2960-24TT, 3560-24PS).${info?.pcIp ? " Use configure_pc to set its IP address." : ""}`
      );
    }
    if (input.commands.length > LIMITS.iosLines) {
      throw new Error(`Too many IOS commands for ${device.name}: ${input.commands.length} (at most ${LIMITS.iosLines} per call).`);
    }
    const long = input.commands.findIndex((c) => c.length > LIMITS.iosLine);
    if (long >= 0) throw new Error(`IOS command ${long + 1} for ${device.name} is longer than ${LIMITS.iosLine} characters.`);
    const { commands, dropped } = sanitizeIos(input.commands);
    if (!commands.length && !input.replace) {
      throw new Error(`No IOS commands left to add for ${device.name}${dropped.length ? ` (dropped: ${dropped.join(" | ")})` : ""}.`);
    }
    const all = [...(input.replace ? [] : (this.configs.get(device.name) ?? [])), ...commands];
    if (all.length > LIMITS.iosLines) {
      throw new Error(
        `${device.name} would have ${all.length} IOS commands; the limit is ${LIMITS.iosLines} per device. ` +
          "Use replace: true to start over with fewer commands."
      );
    }
    if (all.length) this.configs.set(device.name, all);
    else this.configs.delete(device.name);
    return { device, added: commands, dropped, total: all.length };
  }

  /** Sets the FastEthernet0 IP configuration of a host (replaces any previous one). */
  configurePc(input: PcInput): PcResult {
    const device = this.requireDevice(input.name);
    const info = getModelInfo(device.model);
    if (!info?.pcIp) {
      throw new Error(
        `${device.name} (${device.model}) is not a host: configure_pc only works on PC-PT, Server-PT, Laptop-PT and Printer-PT.` +
          (info?.ios ? " For routers and switches use configure_device (e.g. interface GigabitEthernet0/0 / ip address ...)." : "")
      );
    }
    const dns = input.dns?.trim() ? checkIp(input.dns, "dns") : undefined;
    let pc: PcIp;
    const ignored: string[] = [];
    if (input.dhcp) {
      for (const k of ["ip", "mask", "gateway"] as const) if (input[k]?.trim()) ignored.push(k);
      pc = { name: device.name, dhcp: true };
    } else {
      let ipRaw = input.ip?.trim() ?? "";
      let maskRaw = input.mask?.trim() ?? "";
      const cidr = /^([^/]+)\/(\d{1,2})$/.exec(ipRaw);
      if (cidr) {
        if (maskRaw && toMask(maskRaw) !== toMask(cidr[2])) throw new Error(`ip "${ipRaw}" and mask "${maskRaw}" disagree.`);
        ipRaw = cidr[1];
        maskRaw ||= cidr[2];
      }
      if (!ipRaw || !maskRaw) throw new Error(`A static configuration for ${device.name} needs both ip and mask (or set dhcp: true).`);
      pc = { name: device.name, dhcp: false, ip: checkIp(ipRaw, "ip"), mask: toMask(maskRaw) };
      if (input.gateway?.trim()) pc.gateway = checkIp(input.gateway, "gateway");
    }
    if (dns) pc.dns = dns;
    this.pcIps.set(device.name, pc);
    return { pc, ignored };
  }

  toJSON(): TopologyJSON {
    return {
      version: 1,
      devices: [...this.devices.values()].map((d) => ({ ...d })),
      links: this.links.map((l) => ({ ...l })),
      configs: Object.fromEntries([...this.configs].map(([k, v]) => [k, [...v]])),
      pcIps: [...this.pcIps.values()].map((p) => ({ ...p })),
    };
  }

  /**
   * Builds a NEW topology from a spec through the public mutators (so every invariant applies).
   * Throws on the first invalid item, naming it; the caller swaps it in only on success (atomic).
   * `notes` lists alias resolutions, dropped IOS lines and ignored PC fields.
   */
  static fromSpec(spec: TopologySpec): { topology: Topology; notes: string[] } {
    const t = new Topology();
    const notes: string[] = [];
    const step = <T>(label: string, fn: () => T): T => {
      try {
        return fn();
      } catch (e) {
        throw new Error(`${label}: ${(e as Error).message}`);
      }
    };
    spec.devices.forEach((d, i) => {
      const dev = step(`devices[${i}] "${d.name}"`, () => t.addDevice(d));
      if (dev.model !== d.model) notes.push(`${dev.name}: model "${d.model}" resolved to "${dev.model}".`);
    });
    (spec.links ?? []).forEach((l, i) => step(`links[${i}] ${l.dev1}:${l.port1} <-> ${l.dev2}:${l.port2}`, () => t.addLink(l)));
    (spec.ios ?? []).forEach((c, i) => {
      const r = step(`ios[${i}] "${c.name}"`, () => t.configureIos(c));
      if (r.dropped.length) notes.push(`${r.device.name}: dropped IOS lines: ${r.dropped.join(" | ")}.`);
    });
    (spec.pcs ?? []).forEach((p, i) => {
      const r = step(`pcs[${i}] "${p.name}"`, () => t.configurePc(p));
      if (r.ignored.length) notes.push(`${r.pc.name}: DHCP enabled, ignored ${r.ignored.join(", ")}.`);
    });
    return { topology: t, notes };
  }

  /** Validates serialized data (toJSON shape) with zod and rebuilds it through the public mutators. */
  static fromJSON(data: unknown): Topology {
    const parsed = topologyJsonSchema.safeParse(data);
    if (!parsed.success) throw new Error(`Invalid topology data:\n${z.prettifyError(parsed.error)}`);
    const j = parsed.data;
    return Topology.fromSpec({
      devices: j.devices,
      links: j.links,
      ios: Object.entries(j.configs).map(([name, commands]) => ({ name, commands, replace: true })),
      pcs: j.pcIps,
    }).topology;
  }
}
