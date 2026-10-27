/**
 * In-memory topology model. Pure, no MCP imports. Mutators validate their input and throw `Error`
 * with an English message meant for the calling agent.
 */
import { z } from "zod";
import { CABLE_TYPES, type CableType } from "./cables.js";
import { findPort, formatPorts, getModelInfo, normalizePort, resolveModel, samePort, suggestModels } from "./catalog.js";

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

/** Stable serialized shape (toJSON / fromJSON). */
export const topologyJsonSchema = z.object({
  version: z.literal(1).optional(),
  devices: z.array(z.object({ name: z.string(), model: z.string(), x: z.number().optional(), y: z.number().optional() })),
  links: z
    .array(z.object({ dev1: z.string(), port1: z.string(), dev2: z.string(), port2: z.string(), cable: z.enum(CABLE_TYPES).optional() }))
    .default([]),
  configs: z.record(z.string(), z.array(z.string())).default({}),
  pcIps: z
    .array(
      z.object({
        name: z.string(),
        dhcp: z.boolean(),
        ip: z.string().optional(),
        mask: z.string().optional(),
        gateway: z.string().optional(),
        dns: z.string().optional(),
      })
    )
    .default([]),
});
export type TopologyJSON = { version: 1; devices: Device[]; links: Link[]; configs: Record<string, string[]>; pcIps: PcIp[] };

const fmtLink = (l: Link) => `${l.dev1}:${l.port1} <-> ${l.dev2}:${l.port2}`;

const OCTET = "(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const IPV4 = new RegExp(`^${OCTET}(\\.${OCTET}){3}$`);

function checkIp(value: string, field: string): string {
  const v = value.trim();
  if (!IPV4.test(v)) throw new Error(`Invalid ${field} "${value}": expected a dotted-quad IPv4 address such as 192.168.1.10.`);
  return v;
}

/** Accepts a dotted mask (255.255.255.0) or a prefix length (/24 or 24); returns the dotted mask. */
function toMask(value: string): string {
  const v = value.trim();
  const prefix = /^\/?(\d{1,2})$/.exec(v);
  if (prefix) {
    const n = Number(prefix[1]);
    if (n > 32) throw new Error(`Invalid prefix length "${value}": must be 0-32.`);
    const bits = n === 0 ? 0 : (0xffffffff << (32 - n)) >>> 0;
    return [24, 16, 8, 0].map((s) => (bits >>> s) & 255).join(".");
  }
  if (!IPV4.test(v)) throw new Error(`Invalid subnet mask "${value}": use 255.255.255.0 or /24.`);
  const bits = v.split(".").reduce((acc, o) => ((acc << 8) | Number(o)) >>> 0, 0);
  const inv = ~bits >>> 0;
  if ((inv & (inv + 1)) !== 0) throw new Error(`Invalid subnet mask "${value}": the 1-bits must be contiguous.`);
  return v;
}

function checkCoords(x: number | undefined, y: number | undefined) {
  if ((x === undefined) !== (y === undefined)) throw new Error("Give both x and y, or neither (auto layout).");
  for (const v of [x, y]) if (v !== undefined && !Number.isFinite(v)) throw new Error(`Coordinates must be finite numbers, got ${v}.`);
}

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
  devices = new Map<string, Device>();
  links: Link[] = [];
  /** IOS commands per device name, already sanitized. */
  configs = new Map<string, string[]>();
  pcIps = new Map<string, PcIp>();

  reset() {
    this.devices.clear();
    this.links = [];
    this.configs.clear();
    this.pcIps.clear();
  }

  /** Case-insensitive device lookup. */
  getDevice(name: string): Device | undefined {
    const n = name.trim();
    const exact = this.devices.get(n);
    if (exact) return exact;
    const lower = n.toLowerCase();
    for (const d of this.devices.values()) if (d.name.toLowerCase() === lower) return d;
    return undefined;
  }

  requireDevice(name: string): Device {
    const d = this.getDevice(name);
    if (d) return d;
    const names = [...this.devices.keys()];
    throw new Error(`Unknown device "${name}". ${names.length ? `Existing devices: ${names.join(", ")}.` : "The topology is empty."}`);
  }

  /** The link using device:port, if any. */
  findLink(device: string, port: string): Link | undefined {
    const d = this.getDevice(device);
    if (!d) return undefined;
    return this.links.find((l) => (l.dev1 === d.name && samePort(l.port1, port)) || (l.dev2 === d.name && samePort(l.port2, port)));
  }

  addDevice(input: DeviceInput): Device {
    const name = input.name.trim();
    if (!name) throw new Error("Device name must not be empty.");
    const clash = this.getDevice(name);
    if (clash) {
      throw new Error(`A device named "${clash.name}" already exists (names are case-insensitive). Pick another name or use remove_device / rename_device.`);
    }
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

  private checkPort(d: Device, port: string): string {
    const normalized = normalizePort(port);
    if (!normalized) throw new Error(`Port name for ${d.name} must not be empty.`);
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
    const a = this.requireDevice(input.dev1);
    const b = this.requireDevice(input.dev2);
    const port1 = this.checkPort(a, input.port1);
    const port2 = this.checkPort(b, input.port2);
    if (a === b && samePort(port1, port2)) throw new Error(`Cannot link ${a.name}:${port1} to itself.`);
    for (const [d, p] of [[a, port1], [b, port2]] as const) {
      const used = this.findLink(d.name, p);
      if (used) throw new Error(`Port ${d.name}:${p} is already used by the link ${fmtLink(used)}. Use another port or remove_link first.`);
    }
    if (input.cable !== undefined && !CABLE_TYPES.includes(input.cable)) {
      throw new Error(`Unknown cable "${input.cable}". Valid cables: ${CABLE_TYPES.join(", ")}.`);
    }
    const link: Link = { dev1: a.name, port1, dev2: b.name, port2 };
    if (input.cable) link.cable = input.cable;
    this.links.push(link);
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
    const name = newName.trim();
    if (!name) throw new Error("New device name must not be empty.");
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
    const { commands, dropped } = sanitizeIos(input.commands);
    if (!commands.length && !input.replace) {
      throw new Error(`No IOS commands left to add for ${device.name}${dropped.length ? ` (dropped: ${dropped.join(" | ")})` : ""}.`);
    }
    const all = [...(input.replace ? [] : (this.configs.get(device.name) ?? [])), ...commands];
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
