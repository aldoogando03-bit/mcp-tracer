/**
 * Device catalog: PTBuilder model keys, common-model metadata and port helpers.
 * Pure data, no MCP imports. Source of truth: docs/PTBUILDER_API.md §5 (models) and §6 (ports).
 */

export type PortKind =
  | "fastethernet"
  | "gigabitethernet"
  | "ethernet"
  | "serial"
  | "fiber"
  | "console"
  | "rs232"
  | "aux"
  | "modem"
  | "coaxial"
  | "wireless"
  | "other";

/** `verified` is true only when docs §6 confirms the exact name from a primary source. */
export type PortInfo = { name: string; kind: PortKind; verified: boolean };

export type Category = "router" | "switch" | "l3switch" | "host" | "hub" | "wireless" | "firewall" | "cloud" | "phone";

/**
 * How far the port list can be trusted:
 * - verified: every port name confirmed.
 * - partial: the port count is confirmed, so the list is treated as complete (unlisted ports are rejected),
 *   but some names are not verified.
 * - unverified: names come from third parties or convention; unlisted ports are accepted (validation warns).
 * - unknown: no port information.
 */
export type PortsStatus = "verified" | "partial" | "unverified" | "unknown";

export type ModelInfo = {
  /** Exact PTBuilder `allDeviceTypes` key. */
  model: string;
  aliases: string[];
  category: Category;
  /**
   * Cabling layer used for straight/cross inference: 3 = router/host/firewall-like (MDI),
   * 2 = switch/AP-like (MDI-X), 1 = hub. Multilayer switches are 2 because their ports are switch ports.
   */
  layer: 1 | 2 | 3;
  /** Accepts configureIosDevice (PTBuilder device types 0, 1 and 16 only). */
  ios: boolean;
  /** Accepts configurePcIp (needs FastEthernet0; check that port's `verified` flag). */
  pcIp: boolean;
  ports: PortInfo[];
  portsVerified: PortsStatus;
  notes?: string[];
};

/** Every key of PTBuilder's `allDeviceTypes` (docs §5.1). Only these strings can be passed to addDevice. */
export const PTBUILDER_MODELS: ReadonlySet<string> = new Set([
  "1841", "1941", "2620XM", "2621XM", "2811", "2901", "2911", "819HG-4G-IOX", "819HGW", "829", "CGR1240",
  "ISR4321", "ISR4331", "Router-PT", "Router-PT-Empty",
  "2950-24", "2950T-24", "2960-24TT", "Switch-PT", "Switch-PT-Empty",
  "Cloud-PT", "Cloud-PT-Empty", "Bridge-PT", "Hub-PT", "Repeater-PT", "CoAxialSplitter-PT",
  "AccessPoint-PT", "AccessPoint-PT-A", "AccessPoint-PT-AC", "AccessPoint-PT-N",
  "PC-PT", "Server-PT", "Printer-PT", "Linksys-WRT300N", "7960", "DSL-Modem-PT", "Cable-Modem-PT",
  "3560-24PS", "3650-24PS", "IE-2000",
  "Laptop-PT", "TabletPC-PT", "SMARTPHONE-PT", "WirelessEndDevice-PT", "WiredEndDevice-PT", "TV-PT",
  "Home-VoIP-PT", "Analog-Phone-PT", "5505", "5506-X", "DLC100", "HomeRouter-PT-AC", "Cell-Tower",
  "Central-Office-Server", "802", "803", "Sniffer", "MCU-PT", "SBC-PT",
  "Air Conditioner", "Air Cooler", "Alarm", "Appliance", "Atm Pressure Monitor", "Battery", "Beacon", "Blower",
  "Bluetooth Speaker", "Carbon Dioxide Detector", "Carbon Monoxide Detector", "Fan", "Ceiling Sprinkler",
  "Dimmable LED", "Door", "Fire Monitor", "Fire Sprinkler", "Flex Sensor", "Floor Sprinkler", "Furnace",
  "Garage Door", "Generic Environment Sensor", "Generic Sensor", "Heating Element", "Home Speaker", "Humidifier",
  "Humidity Monitor", "Humidity Sensor", "Humiture Monitor", "Humiture Sensor", "LCD", "LED", "Lawn Sprinkler",
  "Light", "Membrane Potentiometer", "Metal Sensor", "Motion Detector", "Motion Sensor", "Motor", "Old Car",
  "Photo Sensor", "Piezo Speaker", "Portable Music Player", "Potentiometer", "Power Meter", "Push Button",
  "Push Button Toggle Switch", "RFID Card", "RFID Reader", "RGB LED", "Rocker Switch", "Servo",
  "Signal Generator", "Siren", "Smart LED", "Smoke Detector", "Smoke Sensor", "Solar Panel",
  "Sound Frequency Detector", "Sound Sensor", "Speaker", "Street Lamp", "Temperature Monitor",
  "Temperature Sensor", "Thermostat", "Thing", "Toggle Push Button", "Trip Sensor", "Trip Wire",
  "Water Detector", "Water Drain", "Water Level Monitor", "Water Sensor", "Webcam", "Wind Detector",
  "Wind Sensor", "Wind Turbine", "Window",
  "Embedded-Server-PT", "WLC-2504", "WLC-3504", "WLC-PT", "3702i", "LAP-PT", "Power Distribution Device",
  "Copper Patch Panel", "Fiber Patch Panel", "Copper Wall Mount", "Fiber Wall Mount", "Meraki-MX65W",
  "Meraki-Server", "NetworkController",
]);

/** allDeviceTypes keys of type 0 (router), 1 (switch) and 16 (multilayer switch): the IOS devices. */
const ROUTER_KEYS = new Set(["1841", "1941", "2620XM", "2621XM", "2811", "2901", "2911", "819HG-4G-IOX", "819HGW", "829", "CGR1240", "ISR4321", "ISR4331", "Router-PT", "Router-PT-Empty"]);
const SWITCH_KEYS = new Set(["2950-24", "2950T-24", "2960-24TT", "Switch-PT", "Switch-PT-Empty"]);
const L3SWITCH_KEYS = new Set(["3560-24PS", "3650-24PS", "IE-2000"]);

const port = (name: string, kind: PortKind, verified = false): PortInfo => ({ name, kind, verified });
const range = (prefix: string, from: number, to: number, kind: PortKind, verified: number[] = []): PortInfo[] =>
  Array.from({ length: to - from + 1 }, (_, i) => port(`${prefix}${from + i}`, kind, verified.includes(from + i)));

const NO_SERIAL = "No onboard serial ports: serial links need a WIC/HWIC module, which this server cannot add yet.";
const routerPorts = (ports: PortInfo[]) => [...ports, port("Console", "console"), port("Aux", "aux")];
const router = (model: string, ports: PortInfo[], portsVerified: PortsStatus, notes: string[], aliases: string[] = []): ModelInfo => ({
  model, aliases, category: "router", layer: 3, ios: true, pcIp: false, ports: routerPorts(ports), portsVerified, notes,
});
const fastSwitchPorts = (gig: boolean, verified: boolean) => [
  ...range("FastEthernet0/", 1, 24, "fastethernet", verified ? [1] : []),
  ...(gig ? range("GigabitEthernet0/", 1, 2, "gigabitethernet", verified ? [1] : []) : []),
  port("Console", "console"),
];

export const CATALOG: ModelInfo[] = [
  router("1841", range("FastEthernet0/", 0, 1, "fastethernet"), "partial",
    ["2 onboard FastEthernet ports (count verified; names follow IOS convention, unverified).", NO_SERIAL]),
  router("1941", range("GigabitEthernet0/", 0, 1, "gigabitethernet"), "partial",
    ["2 onboard GigabitEthernet ports (count verified; names unverified).", NO_SERIAL]),
  router("2811", range("FastEthernet0/", 0, 1, "fastethernet"), "partial",
    ["2 onboard FastEthernet ports (count verified; names unverified).", NO_SERIAL]),
  router("2901", range("GigabitEthernet0/", 0, 1, "gigabitethernet"), "partial",
    ["2 onboard GigabitEthernet ports (count verified; names unverified).", NO_SERIAL]),
  router("2911", range("GigabitEthernet0/", 0, 2, "gigabitethernet", [0, 1]), "partial",
    ["GigabitEthernet0/0-0/1 verified; GigabitEthernet0/2 count verified, name unverified.", NO_SERIAL]),
  router("ISR4321", range("GigabitEthernet0/0/", 0, 1, "gigabitethernet"), "unverified",
    ["Port names from a third-party catalog only.", "Serial links need a NIM-2T module, which this server cannot add yet."],
    ["4321"]),
  router("ISR4331", range("GigabitEthernet0/0/", 0, 2, "gigabitethernet"), "unverified",
    ["Port names from a third-party catalog only.", "Serial links need a NIM-2T module, which this server cannot add yet."],
    ["4331"]),

  { model: "2950-24", aliases: ["2950"], category: "switch", layer: 2, ios: true, pcIp: false,
    ports: fastSwitchPorts(false, false), portsVerified: "unverified" },
  { model: "2950T-24", aliases: ["2950T"], category: "switch", layer: 2, ios: true, pcIp: false,
    ports: fastSwitchPorts(true, false), portsVerified: "unverified" },
  { model: "2960-24TT", aliases: ["2960", "2960-24", "Catalyst 2960"], category: "switch", layer: 2, ios: true, pcIp: false,
    ports: fastSwitchPorts(true, true), portsVerified: "partial",
    notes: [
      "FastEthernet0/1 and GigabitEthernet0/1 verified; the rest of FastEthernet0/1-24 and GigabitEthernet0/1-2 count verified, names unverified.",
      "Vlan1 is an SVI, not a cabling port.",
    ] },

  { model: "3560-24PS", aliases: ["3560", "3560-24"], category: "l3switch", layer: 2, ios: true, pcIp: false,
    ports: fastSwitchPorts(true, false), portsVerified: "unverified",
    notes: ["Preferred multilayer switch (the 3650-24PS ships without a power supply)."] },
  { model: "3650-24PS", aliases: ["3650", "3650-24"], category: "l3switch", layer: 2, ios: true, pcIp: false,
    ports: [...range("GigabitEthernet1/0/", 1, 24, "gigabitethernet"), port("Console", "console")], portsVerified: "unverified",
    notes: [
      "Ships without a power supply in Packet Tracer and PTBuilder could not add one: it may stay powered off. Prefer 3560-24PS.",
      "SFP uplinks need GLC modules in slots 2/0-2/3, which this server cannot add yet.",
    ] },

  { model: "PC-PT", aliases: ["PC", "Desktop", "Workstation", "Computer"], category: "host", layer: 3, ios: false, pcIp: true,
    ports: [port("FastEthernet0", "fastethernet", true), port("RS232", "rs232")], portsVerified: "partial",
    notes: ["RS232 console port name unverified."] },
  { model: "Server-PT", aliases: ["Server"], category: "host", layer: 3, ios: false, pcIp: true,
    ports: [port("FastEthernet0", "fastethernet", true)], portsVerified: "partial" },
  { model: "Laptop-PT", aliases: ["Laptop", "Notebook"], category: "host", layer: 3, ios: false, pcIp: true,
    ports: [port("FastEthernet0", "fastethernet"), port("RS232", "rs232")], portsVerified: "unverified",
    notes: ["FastEthernet0 unverified: configure_pc (configurePcIp) may fail on this model."] },
  { model: "Printer-PT", aliases: ["Printer"], category: "host", layer: 3, ios: false, pcIp: true,
    ports: [port("FastEthernet0", "fastethernet")], portsVerified: "unverified",
    notes: ["FastEthernet0 unverified: configure_pc (configurePcIp) may fail on this model."] },

  { model: "Hub-PT", aliases: ["Hub"], category: "hub", layer: 1, ios: false, pcIp: false, ports: [], portsVerified: "unknown",
    notes: ["Port names unknown."] },
  { model: "Cloud-PT", aliases: ["Cloud"], category: "cloud", layer: 2, ios: false, pcIp: false,
    ports: [
      ...range("Serial", 0, 3, "serial"), ...range("Modem", 4, 5, "modem"),
      port("Ethernet6", "ethernet", true), port("Coaxial7", "coaxial"),
    ],
    portsVerified: "unverified", notes: ["Only Ethernet6 is verified; the other ports come from a third-party catalog."] },
  { model: "AccessPoint-PT", aliases: ["AccessPoint", "Access Point", "AP"], category: "wireless", layer: 2, ios: false, pcIp: false,
    ports: [port("Port 0", "ethernet")], portsVerified: "unverified",
    notes: ["Cabled like an end device: straight to switches/hubs, cross to routers and hosts (PT FAQ #27)."] },
  { model: "Linksys-WRT300N", aliases: ["WRT300N", "WRT-300N", "Linksys", "Wireless Router"], category: "wireless", layer: 2,
    ios: false, pcIp: false,
    ports: [port("Internet", "ethernet"), ...range("Ethernet ", 1, 4, "ethernet")], portsVerified: "unverified",
    notes: ["1 Internet + 4 Ethernet ports (count verified; names unverified)."] },
  { model: "5505", aliases: ["ASA5505", "ASA 5505"], category: "firewall", layer: 3, ios: false, pcIp: false,
    ports: [], portsVerified: "unknown",
    notes: ["Port names unknown (sources conflict).", "ASA CLI differs from IOS: configure_device is not supported."] },
  { model: "5506-X", aliases: ["ASA5506-X", "ASA5506X", "ASA5506", "ASA 5506-X", "5506"], category: "firewall", layer: 3,
    ios: false, pcIp: false, ports: [], portsVerified: "unknown",
    notes: ["Port names unknown (sources conflict).", "ASA CLI differs from IOS: configure_device is not supported."] },
  { model: "7960", aliases: ["IP Phone 7960", "IP Phone", "IPPhone", "Cisco 7960"], category: "phone", layer: 3, ios: false,
    pcIp: false, ports: [], portsVerified: "unknown",
    notes: ["Port names unknown.", "Needs a power adapter module, which this server cannot add yet."] },
];

const key = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");

const BY_MODEL = new Map(CATALOG.map((m) => [m.model, m]));
const BY_KEY = new Map<string, string>();
for (const m of PTBUILDER_MODELS) BY_KEY.set(key(m), m);
const BY_ALIAS = new Map<string, string>();
for (const m of CATALOG) for (const a of m.aliases) BY_ALIAS.set(key(a), m.model);

const lookup = (k: string) => BY_KEY.get(k) ?? BY_ALIAS.get(k);

/**
 * Resolves user input to an exact PTBuilder model key: case-, space- and hyphen-insensitive, with aliases
 * ("4331" -> ISR4331, "WRT300N" -> Linksys-WRT300N, "ASA5505" -> 5505, "PC" -> PC-PT), an optional "Cisco"
 * prefix and an implied "-PT" suffix. `info` is set only for catalogued models.
 */
export function resolveModel(input: string): { model: string; info?: ModelInfo } | undefined {
  const k = key(input);
  if (!k) return undefined;
  const stripped = k.replace(/^(cisco|catalyst)/, "");
  const model = lookup(k) ?? (stripped ? lookup(stripped) : undefined) ?? BY_KEY.get(`${stripped}pt`);
  return model ? { model, info: BY_MODEL.get(model) } : undefined;
}

/**
 * Catalog info for an exact model key. For uncatalogued router/switch/multilayer keys (e.g. Router-PT)
 * a minimal entry with unknown ports is synthesized so device-type rules still apply.
 */
export function getModelInfo(model: string): ModelInfo | undefined {
  const info = BY_MODEL.get(model);
  if (info) return info;
  const category: Category | undefined = ROUTER_KEYS.has(model) ? "router" : SWITCH_KEYS.has(model) ? "switch" : L3SWITCH_KEYS.has(model) ? "l3switch" : undefined;
  if (!category) return undefined;
  return { model, aliases: [], category, layer: category === "router" ? 3 : 2, ios: true, pcIp: false, ports: [], portsVerified: "unknown" };
}

/** True for PTBuilder device types 0, 1 and 16 (routers, switches, multilayer switches). */
export const isIosModel = (model: string) => ROUTER_KEYS.has(model) || SWITCH_KEYS.has(model) || L3SWITCH_KEYS.has(model);

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

/** Closest model keys to an unknown input (catalogued models first on ties). */
export function suggestModels(input: string, limit = 5): string[] {
  const k = key(input).slice(0, 64); // the edit distance is O(length), so cap it
  const best = new Map<string, number>();
  const consider = (candidate: string, model: string) => {
    let d = distance(k, candidate);
    if (k && (candidate.includes(k) || k.includes(candidate))) d = Math.min(d, 1);
    if (!BY_MODEL.has(model)) d += 0.5;
    if (d < (best.get(model) ?? Infinity)) best.set(model, d);
  };
  for (const [c, m] of BY_KEY) consider(c, m);
  for (const [c, m] of BY_ALIAS) consider(c, m);
  return [...best].sort((a, b) => a[1] - b[1]).slice(0, limit).map(([m]) => m);
}

const PREFIXES = new Map<string, string>();
const prefix = (canonical: string, ...abbrevs: string[]) => {
  for (const a of [canonical.toLowerCase(), ...abbrevs]) PREFIXES.set(a, canonical);
};
prefix("GigabitEthernet", "g", "gi", "gig", "gige", "gigabit");
prefix("TenGigabitEthernet", "te", "ten", "tengig", "tengige");
prefix("FastEthernet", "f", "fa", "fas", "fast");
prefix("Ethernet", "e", "et", "eth", "ether");
prefix("Serial", "s", "se", "ser");
prefix("Console", "con", "cons");
prefix("Aux", "auxiliary");
prefix("Modem", "mo", "mod");
prefix("Coaxial", "coax");
prefix("Wireless", "wl", "wlan");
prefix("Loopback", "lo");
prefix("Vlan", "vl");
prefix("Port-channel", "po", "portchannel");
prefix("Internet");
prefix("Port");

/** Longest port name accepted anywhere. normalizePort returns longer input trimmed, without parsing it. */
export const MAX_PORT_LENGTH = 64;

/**
 * Expands known interface prefixes and their abbreviations to Packet Tracer's full names and strips spaces:
 * "gi0/0" -> GigabitEthernet0/0, "Fa 0/1" -> FastEthernet0/1, "se0/0/0" -> Serial0/0/0, "con" -> Console,
 * "rs 232" -> RS232. Generic "Port N" names keep their space. Anything else (unknown prefixes such as "foo 1",
 * other shapes, names over MAX_PORT_LENGTH) is returned trimmed but otherwise as given.
 */
export function normalizePort(name: string): string {
  const s = name.trim();
  if (s.length > MAX_PORT_LENGTH) return s;
  if (/^rs[\s-]*232$/i.test(s)) return "RS232";
  // Linear time: the prefix must end with a letter, so it never competes with the separator run after it.
  const m = /^([a-z](?:[a-z_-]*[a-z])?)[\s_-]*(\d[\d\s/.:]*)?$/i.exec(s);
  const canonical = m && (PREFIXES.get(m[1].toLowerCase().replace(/[_-]/g, "")) ?? PREFIXES.get(m[1].toLowerCase()));
  if (!m || !canonical) return s;
  const rest = (m[2] ?? "").replace(/\s+/g, "");
  if (canonical === "Port") return rest ? `Port ${rest}` : "Port";
  if ((canonical === "Console" || canonical === "Aux") && (rest === "" || rest === "0")) return canonical;
  return canonical + rest;
}

/** Comparison key of a port name: normalized, lowercased, spaces removed. */
export const portKey = (name: string) => normalizePort(name).toLowerCase().replace(/\s+/g, "");

/** True when two port names denote the same port (case, spaces and abbreviations ignored). */
export const samePort = (a: string, b: string) => portKey(a) === portKey(b);

/** Finds a catalog port by name, ignoring case, spaces and abbreviations. */
export function findPort(info: ModelInfo | undefined, portName: string): PortInfo | undefined {
  if (!info) return undefined;
  const k = portKey(portName);
  return info.ports.find((p) => portKey(p.name) === k);
}

/** Compact list such as "FastEthernet0/1-24, GigabitEthernet0/1-2, Console". */
export function formatPorts(ports: PortInfo[]): string {
  const groups: { name: string; base: string; first: number; last: number }[] = [];
  for (const p of ports) {
    const m = /^(.*?)(\d+)$/.exec(p.name);
    const g = groups[groups.length - 1];
    if (m && g && g.base === m[1] && g.last + 1 === Number(m[2])) g.last++;
    else groups.push({ name: p.name, base: m ? m[1] : p.name, first: m ? Number(m[2]) : NaN, last: m ? Number(m[2]) : NaN });
  }
  return groups.map((g) => (g.last > g.first ? `${g.name}-${g.last}` : g.name)).join(", ");
}

/** Port kind guessed from the name prefix (fiber cannot be told apart by name). */
export function portKind(name: string): PortKind {
  const n = normalizePort(name);
  const kinds: [RegExp, PortKind][] = [
    [/^GigabitEthernet/, "gigabitethernet"],
    [/^FastEthernet/, "fastethernet"],
    [/^(Ethernet|Port |Internet)/, "ethernet"],
    [/^Serial/, "serial"],
    [/^Console/, "console"],
    [/^RS232/, "rs232"],
    [/^Aux/, "aux"],
    [/^Modem/, "modem"],
    [/^Coaxial/, "coaxial"],
    [/^Wireless/, "wireless"],
  ];
  return kinds.find(([re]) => re.test(n))?.[1] ?? "other";
}
