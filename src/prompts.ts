/**
 * MCP prompts: ready-made labs. Each returns one user message with the exact build_topology arguments
 * (addressing computed here), the follow-up tool calls and the checks to run in Packet Tracer.
 * Only catalogued models with verified (or count-verified) ports: 2911, 2960-24TT, 3560-24PS, PC-PT, Server-PT.
 */
import { completable } from "@modelcontextprotocol/sdk/server/completable.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { compactJson } from "./render.js";

// ---------- IPv4 math ----------

type Net = { addr: number; prefix: number };

const OCTET = "(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const IPV4 = new RegExp(`^${OCTET}(\\.${OCTET}){3}$`);
const toInt = (s: string) => s.split(".").reduce((a, o) => ((a << 8) | Number(o)) >>> 0, 0);
const ip = (n: number) => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join(".");
const maskInt = (p: number) => (p === 0 ? 0 : (0xffffffff << (32 - p)) >>> 0);
const mask = (p: number) => ip(maskInt(p));
const wildcard = (p: number) => ip(~maskInt(p) >>> 0);
const cidr = (n: Net) => `${ip(n.addr)}/${n.prefix}`;
const overlaps = (a: Net, b: Net) => {
  const m = maskInt(Math.min(a.prefix, b.prefix));
  return ((a.addr & m) >>> 0) === ((b.addr & m) >>> 0);
};

/** "192.168.10.0/24" or "192.168.10.0 255.255.255.0"; host bits are cleared. */
function parseNet(s: string): { net: Net; hostBits: boolean } | undefined {
  const m = /^\s*([\d.]+)\s*(?:\/\s*(\d{1,2})|\s([\d.]+))\s*$/.exec(s);
  if (!m || !IPV4.test(m[1])) return undefined;
  let prefix: number;
  if (m[2] !== undefined) {
    prefix = Number(m[2]);
    if (prefix > 32) return undefined;
  } else {
    if (!IPV4.test(m[3])) return undefined;
    const inv = ~toInt(m[3]) >>> 0;
    if ((inv & (inv + 1)) !== 0) return undefined;
    prefix = 32 - Math.log2(inv + 1);
  }
  const raw = toInt(m[1]);
  const addr = (raw & maskInt(prefix)) >>> 0;
  return { net: { addr, prefix }, hostBits: addr !== raw };
}

// ---------- argument parsing (invalid values fall back to defaults, with a note) ----------

const ALIASES: Record<string, string> = { roas: "router-on-a-stick", l3: "l3-switch", svi: "l3-switch", overload: "pat", nat: "static" };

function choice<T extends string>(name: string, value: string | undefined, options: readonly T[], def: T, notes: string[]): T {
  const v = value?.trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (!v) return def;
  const hit = options.find((o) => o === v || o === ALIASES[v]);
  if (hit) return hit;
  notes.push(`${name} "${value}" is not one of ${options.join(", ")}; using ${def}.`);
  return def;
}

function int(name: string, value: string | undefined, def: number, min: number, max: number, notes: string[]): number {
  const v = value?.trim();
  if (!v) return def;
  if (!/^\d+$/.test(v)) {
    notes.push(`${name} "${value}" is not a whole number; using ${def}.`);
    return def;
  }
  const n = Math.min(max, Math.max(min, Number(v)));
  if (String(n) !== String(Number(v))) notes.push(`${name} must be ${min}-${max}; using ${n}.`);
  return n;
}

/** Parses a network argument; on a bad or rejected value falls back to the first default that passes `check`. */
function network(name: string, value: string | undefined, defaults: string[], check: (n: Net) => string | undefined, notes: string[]): Net {
  const fallback = () => defaults.map((d) => parseNet(d)!.net).find((n) => !check(n)) ?? parseNet(defaults[0])!.net;
  const v = value?.trim();
  if (!v) return fallback();
  const p = parseNet(v);
  if (!p) {
    const n = fallback();
    notes.push(`${name} "${value}" is not a network such as 192.168.10.0/24; using ${cidr(n)}.`);
    return n;
  }
  const problem = check(p.net);
  if (problem) {
    const n = fallback();
    notes.push(`${name} ${cidr(p.net)} ${problem}; using ${cidr(n)}.`);
    return n;
  }
  if (p.hostBits) notes.push(`${name} "${v}" has host bits set; using ${cidr(p.net)}.`);
  return p.net;
}

// ---------- message assembly ----------

type Device = { name: string; model: string };
type LinkSpec = { dev1: string; port1: string; dev2: string; port2: string };
type Pc = { name: string; dhcp?: boolean; ip?: string; mask?: string; gateway?: string };
type Spec = { devices: Device[]; links: LinkSpec[]; ios: { name: string; commands: string[] }[]; pcs: Pc[] };

const G = (n: string) => `GigabitEthernet${n}`;
const F = (n: string) => `FastEthernet${n}`;
const link = (dev1: string, port1: string, dev2: string, port2: string): LinkSpec => ({ dev1, port1, dev2, port2 });
const iface = (name: string, ...body: string[]) => [`interface ${name}`, ...body, "exit"];

function lab(o: {
  goal: string;
  notes: string[];
  design: string[];
  spec: Spec;
  manual?: string;
  verify: string[];
  /** Other validate_config warnings the lab triggers on purpose. */
  expected?: string;
}): GetPromptResult {
  const list = (items: string[]) => items.map((i) => `- ${i}`).join("\n");
  const steps = [
    "Call build_topology with exactly these arguments. They use only catalogued models and ports and omit cables and x/y, " +
      "so the server infers the cables and places the devices. IOS blocks run in global configuration mode: never add " +
      "enable, configure terminal, end or write memory; leave sub-modes with exit.\n```json\n" +
      compactJson(o.spec) +
      "\n```",
    "Call validate_config and fix every error before going on. Warnings that some port names are unverified are " +
      `expected (conventional names not yet confirmed in a real PT run${o.expected ? `; so is ${o.expected}` : ""}): ` +
      "mention them to the user but keep the design.",
    "Call generate_script. Give the user the script and tell them: in Packet Tracer open a NEW, empty workspace " +
      "(File > New), open Extensions > Builder Code Editor, paste the script and click Run.",
    ...(o.manual ? [o.manual] : []),
    `Tell the user how to verify in Packet Tracer once the link lights are green (switch ports take about 30 s):\n${list(o.verify)}`,
  ];
  const text = [
    o.goal,
    ...(o.notes.length ? [`Argument notes (tell the user): ${o.notes.join(" ")}`] : []),
    `Design:\n${list(o.design)}`,
    `Steps:\n${steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
  ].join("\n\n");
  return { messages: [{ role: "user", content: { type: "text", text } }] };
}

// ---------- vlan_lab ----------

const INTER_VLAN = ["router-on-a-stick", "l3-switch", "none"] as const;

function vlanLab(a: { vlans?: string; hosts_per_vlan?: string; inter_vlan?: string }): GetPromptResult {
  const notes: string[] = [];
  let vlans: number[] = [];
  if (a.vlans?.trim()) {
    const bad: string[] = [];
    for (const tok of a.vlans.split(/[\s,;]+/).filter(Boolean)) {
      const n = /^\d+$/.test(tok) ? Number(tok) : NaN;
      if (n >= 2 && n <= 1001) {
        if (!vlans.includes(n)) vlans.push(n);
      } else bad.push(tok);
    }
    if (bad.length) notes.push(`Ignored VLAN IDs ${bad.join(", ")} (use 2-1001).`);
    if (vlans.length > 6) {
      notes.push(`At most 6 VLANs; using ${vlans.slice(0, 6).join(", ")}.`);
      vlans = vlans.slice(0, 6);
    }
  }
  if (!vlans.length) {
    if (a.vlans?.trim()) notes.push("No valid VLAN ID given; using 10, 20, 30.");
    vlans = [10, 20, 30];
  }
  const per = int("hosts_per_vlan", a.hosts_per_vlan, 2, 1, 4, notes);
  const mode = choice("inter_vlan", a.inter_vlan, INTER_VLAN, "router-on-a-stick", notes);
  const routed = mode !== "none";

  const prefixes = vlans.map((v, i) => (v <= 255 ? `192.168.${v}` : `172.16.${i + 1}`));
  vlans.forEach((v, i) => v > 255 && notes.push(`VLAN ${v} uses ${prefixes[i]}.0/24 (IDs above 255 do not fit 192.168.<vlan>.0).`));
  const hosts = vlans.flatMap((vlan, i) =>
    Array.from({ length: per }, (_, j) => {
      const n = i * per + j + 1;
      return { name: `PC${n}`, port: n, vlan, ip: `${prefixes[i]}.${10 + j}`, gateway: `${prefixes[i]}.1` };
    })
  );

  const vlanDefs = vlans.flatMap((v) => [`vlan ${v}`, `name VLAN${v}`, "exit"]);
  const access = vlans.flatMap((v, i) => {
    const first = i * per + 1;
    const last = first + per - 1;
    const name = first === last ? `interface ${F(`0/${first}`)}` : `interface range ${F(`0/${first}`)} - ${last}`;
    return [name, "switchport mode access", `switchport access vlan ${v}`, "exit"];
  });
  const s1 = ["hostname S1", ...vlanDefs, ...(routed ? iface(G("0/1"), "switchport mode trunk") : []), ...access];
  const svi = (i: number) => `${prefixes[i]}.1 255.255.255.0`;

  const spec: Spec = { devices: [], links: [], ios: [], pcs: [] };
  if (mode === "router-on-a-stick") {
    spec.devices.push({ name: "R1", model: "2911" });
    spec.links.push(link("R1", G("0/0"), "S1", G("0/1")));
    spec.ios.push({
      name: "R1",
      commands: [
        "hostname R1",
        ...iface(G("0/0"), "no shutdown"),
        ...vlans.flatMap((v, i) => iface(G(`0/0.${v}`), `encapsulation dot1Q ${v}`, `ip address ${svi(i)}`)),
      ],
    });
  } else if (mode === "l3-switch") {
    spec.devices.push({ name: "MLS1", model: "3560-24PS" });
    spec.links.push(link("MLS1", G("0/1"), "S1", G("0/1")));
    spec.ios.push({
      name: "MLS1",
      commands: [
        "hostname MLS1",
        "ip routing",
        ...vlanDefs,
        ...iface(G("0/1"), "switchport trunk encapsulation dot1q", "switchport mode trunk"),
        ...vlans.flatMap((v, i) => iface(`Vlan${v}`, `ip address ${svi(i)}`, "no shutdown")),
      ],
    });
  }
  spec.devices.push({ name: "S1", model: "2960-24TT" }, ...hosts.map((h) => ({ name: h.name, model: "PC-PT" })));
  spec.links.push(...hosts.map((h) => link(h.name, F("0"), "S1", F(`0/${h.port}`))));
  spec.ios.push({ name: "S1", commands: s1 });
  spec.pcs = hosts.map((h) => ({ name: h.name, ip: h.ip, mask: "255.255.255.0", ...(routed ? { gateway: h.gateway } : {}) }));

  const gwWhere = (v: number) => (mode === "router-on-a-stick" ? `R1 ${G(`0/0.${v}`)}` : `MLS1 Vlan${v}`);
  const design = [
    mode === "router-on-a-stick"
      ? `Router-on-a-stick: R1 (2911) ${G("0/0")} with one dot1Q subinterface per VLAN <-> S1 (2960-24TT) trunk ${G("0/1")}.`
      : mode === "l3-switch"
        ? `Inter-VLAN routing on MLS1 (3560-24PS, ip routing, one SVI per VLAN) <-> S1 (2960-24TT) trunk on ${G("0/1")} at both ends.`
        : "S1 (2960-24TT) only, no inter-VLAN routing: PCs reach only their own VLAN.",
    ...vlans.map((v, i) => {
      const hs = hosts.filter((h) => h.vlan === v);
      const gw = routed ? `, gateway ${prefixes[i]}.1 (${gwWhere(v)})` : "";
      return `VLAN ${v}: ${prefixes[i]}.0/24${gw}; ${hs.map((h) => `${h.name} ${h.ip} on S1 ${F(`0/${h.port}`)}`).join(", ")}.`;
    }),
  ];
  const other = hosts.find((h) => h.vlan !== vlans[0]);
  const verify = [
    `S1: show vlan brief (access ports in the right VLANs)${routed ? ", show interfaces trunk" : ""}.`,
    ...(mode === "router-on-a-stick" ? ["R1: show ip interface brief (subinterfaces up/up)."] : []),
    ...(mode === "l3-switch" ? ["MLS1: show ip route (one connected route per VLAN), show interfaces trunk."] : []),
    ...(per > 1 ? [`From PC1 ping ${hosts[1].ip} (${hosts[1].name}, same VLAN).`] : []),
    ...(other
      ? [routed ? `From PC1 ping ${other.ip} (${other.name}, VLAN ${other.vlan}, routed); the first ping may time out while ARP resolves.` : `From PC1 ping ${other.ip} (${other.name}, VLAN ${other.vlan}): it must fail.`]
      : routed ? [`From PC1 ping its gateway ${hosts[0].gateway}.`] : []),
  ];
  const expected = routed ? undefined : "the warning that the PCs have no default gateway";
  return lab({ goal: "Build a VLAN lab in Cisco Packet Tracer with the packet-tracer-mcp tools.", notes, design, spec, verify, expected });
}

// ---------- ospf_lab ----------

function ospfLab(a: { routers?: string; area?: string; topology?: string }): GetPromptResult {
  const notes: string[] = [];
  const n = int("routers", a.routers, 3, 2, 6, notes);
  let shape = choice("topology", a.topology, ["chain", "ring"] as const, "chain", notes);
  if (shape === "ring" && n < 3) {
    notes.push("A ring needs at least 3 routers; using a chain.");
    shape = "chain";
  }
  let area = a.area?.trim() || "0";
  if (!(/^\d+$/.test(area) && Number(area) <= 4294967295) && !IPV4.test(area)) {
    notes.push(`area "${a.area}" is not a number (0-4294967295) or dotted area ID; using 0.`);
    area = "0";
  } else if (/^\d+$/.test(area)) area = String(Number(area));

  const pairs: [number, number][] = Array.from({ length: n - 1 }, (_, k) => [k + 1, k + 2]);
  if (shape === "ring") pairs.push([n, 1]);
  const hasNext = (r: number) => pairs.some(([x]) => x === r);
  /** The link to the next router uses Gi0/1; the link to the previous one Gi0/2, or Gi0/1 when that port is free. */
  const links = pairs.map(([x, y], k) => ({ x, y, px: G("0/1"), py: hasNext(y) ? G("0/2") : G("0/1"), base: 4 * k }));
  const usesGi2 = links.some((l) => l.py === G("0/2"));

  const spec: Spec = { devices: [], links: [], ios: [], pcs: [] };
  for (let r = 1; r <= n; r++) spec.devices.push({ name: `R${r}`, model: "2911" });
  for (let r = 1; r <= n; r++) spec.devices.push({ name: `PC${r}`, model: "PC-PT" });
  for (let r = 1; r <= n; r++) spec.links.push(link(`PC${r}`, F("0"), `R${r}`, G("0/0")));
  for (const l of links) spec.links.push(link(`R${l.x}`, l.px, `R${l.y}`, l.py));
  for (let r = 1; r <= n; r++) {
    const ifs = [
      { port: G("0/0"), addr: `192.168.${r}.1 255.255.255.0` },
      ...links.flatMap((l) => [
        ...(l.x === r ? [{ port: l.px, addr: `10.0.0.${l.base + 1} 255.255.255.252` }] : []),
        ...(l.y === r ? [{ port: l.py, addr: `10.0.0.${l.base + 2} 255.255.255.252` }] : []),
      ]),
    ].sort((p, q) => p.port.localeCompare(q.port));
    const nets = links.filter((l) => l.x === r || l.y === r).map((l) => `network 10.0.0.${l.base} 0.0.0.3 area ${area}`);
    spec.ios.push({
      name: `R${r}`,
      commands: [
        `hostname R${r}`,
        ...ifs.flatMap((i) => iface(i.port, `ip address ${i.addr}`, "no shutdown")),
        "router ospf 1",
        `router-id ${r}.${r}.${r}.${r}`,
        `network 192.168.${r}.0 0.0.0.255 area ${area}`,
        ...nets,
        `passive-interface ${G("0/0")}`,
        "exit",
      ],
    });
    spec.pcs.push({ name: `PC${r}`, ip: `192.168.${r}.10`, mask: "255.255.255.0", gateway: `192.168.${r}.1` });
  }

  const design = [
    `${n} routers (2911) in a ${shape}, OSPF process 1, area ${area}, router-id N.N.N.N on RN.`,
    `LANs: RN ${G("0/0")} 192.168.N.1/24 (passive) <-> PCN 192.168.N.10, for N = 1-${n}.`,
    ...links.map((l) => `R${l.x} ${l.px} 10.0.0.${l.base + 1}/30 <-> R${l.y} ${l.py} 10.0.0.${l.base + 2}/30.`),
    ...(usesGi2 ? [`${G("0/2")} exists on the 2911 (port count verified) but its exact name is unverified.`] : []),
  ];
  const ringLink = links[links.length - 1];
  const verify = [
    "Each router: show ip ospf neighbor (FULL with every directly linked router), show ip route ospf (every 192.168.N.0/24 LAN).",
    `From PC1 ping 192.168.${n}.10 (PC${n}) once OSPF has converged (about 40 s after the links come up).`,
    ...(shape === "ring"
      ? [
          `Resilience: in R${ringLink.x}'s CLI run enable, configure terminal, interface ${ringLink.px}, shutdown; ` +
            `PC1 must still reach PC${n} the other way round the ring.`,
        ]
      : []),
  ];
  return lab({ goal: "Build an OSPF lab in Cisco Packet Tracer with the packet-tracer-mcp tools.", notes, design, spec, verify });
}

// ---------- dhcp_lab ----------

function dhcpLab(a: { network?: string; dhcp_server?: string; hosts?: string }): GetPromptResult {
  const notes: string[] = [];
  const count = int("hosts", a.hosts, 3, 1, 20, notes);
  const mode = choice("dhcp_server", a.dhcp_server, ["router", "server"] as const, "router", notes);
  const reservedMin = mode === "server" ? 2 : 1;
  const net = network(
    "network",
    a.network,
    ["192.168.10.0/24"],
    (x) =>
      x.prefix < 8 || x.prefix > 30
        ? "must have a prefix between /8 and /30"
        : 2 ** (32 - x.prefix) - 2 - count < reservedMin
          ? `is too small for ${count} hosts plus the gateway${mode === "server" ? " and the server" : ""}`
          : undefined,
    notes
  );
  const usable = 2 ** (32 - net.prefix) - 2;
  const reserved = Math.min(10, usable - count);
  const first = net.addr + 1;
  const gw = ip(first);
  const m = mask(net.prefix);
  const poolStart = ip(first + reserved);
  const excluded = reserved > 1 ? `${gw} ${ip(first + reserved - 1)}` : gw;
  const srv = ip(first + 1);

  const pcs = Array.from({ length: count }, (_, i) => `PC${i + 1}`);
  const spec: Spec = {
    devices: [
      { name: "R1", model: "2911" },
      { name: "S1", model: "2960-24TT" },
      ...pcs.map((name) => ({ name, model: "PC-PT" })),
      ...(mode === "server" ? [{ name: "SRV1", model: "Server-PT" }] : []),
    ],
    links: [
      link("R1", G("0/0"), "S1", G("0/1")),
      ...pcs.map((p, i) => link(p, F("0"), "S1", F(`0/${i + 1}`))),
      ...(mode === "server" ? [link("SRV1", F("0"), "S1", F(`0/${count + 1}`))] : []),
    ],
    ios: [
      {
        name: "R1",
        commands: [
          "hostname R1",
          ...(mode === "router"
            ? [`ip dhcp excluded-address ${excluded}`, "ip dhcp pool LAN", `network ${ip(net.addr)} ${m}`, `default-router ${gw}`, "exit"]
            : []),
          ...iface(G("0/0"), `ip address ${gw} ${m}`, "no shutdown"),
        ],
      },
      { name: "S1", commands: ["hostname S1"] },
    ],
    pcs: [...pcs.map((name) => ({ name, dhcp: true })), ...(mode === "server" ? [{ name: "SRV1", ip: srv, mask: m, gateway: gw }] : [])],
  };

  const maxUsers = Math.min(usable - reserved, 250);
  const design = [
    `LAN ${cidr(net)}: R1 (2911) ${G("0/0")} ${gw} is the gateway, S1 (2960-24TT) connects ${pcs.join(", ")} (DHCP clients).`,
    mode === "router"
      ? `DHCP on R1: pool LAN, excluded ${excluded.replace(" ", " - ")}, leases from ${poolStart}.`
      : `DHCP on SRV1 (Server-PT, static ${srv}); R1 is only the gateway. Leases from ${poolStart}.`,
  ];
  const manual =
    mode === "server"
      ? "PTBuilder cannot configure server services, so tell the user to do this by hand after Run: click SRV1 > Services > " +
        `DHCP, select serverPool, set Default Gateway ${gw}, DNS Server 0.0.0.0, Start IP Address ${poolStart}, Subnet Mask ${m}, ` +
        `Maximum Number of Users ${maxUsers}, click Save, then turn the service On.`
      : undefined;
  const verify = [
    `Each PC: Desktop > IP Configuration shows DHCP with an address from ${poolStart} up and gateway ${gw}. If it shows a ` +
      "169.254.x.x (APIPA) address, wait for green links (and the DHCP service) and click DHCP again.",
    ...(mode === "router" ? ["R1: show ip dhcp binding, show ip dhcp pool."] : []),
    `From PC1 ping ${gw}${count > 1 ? " and PC2's leased address" : ""}.`,
  ];
  return lab({ goal: "Build a DHCP lab in Cisco Packet Tracer with the packet-tracer-mcp tools.", notes, design, spec, manual, verify });
}

// ---------- nat_lab ----------

function natLab(a: { nat_type?: string; inside_network?: string; outside_network?: string }): GetPromptResult {
  const notes: string[] = [];
  const type = choice("nat_type", a.nat_type, ["pat", "static", "dynamic"] as const, "pat", notes);
  const range = (x: Net) => (x.prefix < 8 || x.prefix > 28 ? "must have a prefix between /8 and /28" : undefined);
  const inside = network("inside_network", a.inside_network, ["192.168.1.0/24", "10.1.1.0/24"], range, notes);
  const outside = network(
    "outside_network",
    a.outside_network,
    ["203.0.113.0/24", "198.51.100.0/24", "192.0.2.0/24"],
    (x) => range(x) ?? (overlaps(x, inside) ? `overlaps the inside network ${cidr(inside)}` : undefined),
    notes
  );
  const web =
    ["198.51.100.0/24", "192.0.2.0/24", "100.64.0.0/24"].map((s) => parseNet(s)!.net).find((x) => !overlaps(x, inside) && !overlaps(x, outside))!;

  const O = outside.addr;
  const r1Out = ip(O + 1);
  const ispIn = ip(O + 2);
  const block = `${ip(O + 8)} 255.255.255.248`;
  const gwIn = ip(inside.addr + 1);
  const pc1 = ip(inside.addr + 10);
  const pc2 = ip(inside.addr + 11);
  const ispWeb = ip(web.addr + 1);
  const webIp = ip(web.addr + 10);
  const acl = `access-list 1 permit ${ip(inside.addr)} ${wildcard(inside.prefix)}`;
  const nat =
    type === "pat"
      ? [acl, `ip nat inside source list 1 interface ${G("0/1")} overload`]
      : type === "dynamic"
        ? [acl, `ip nat pool PUBLIC ${ip(O + 9)} ${ip(O + 14)} netmask 255.255.255.248`, "ip nat inside source list 1 pool PUBLIC"]
        : [`ip nat inside source static ${pc1} ${ip(O + 9)}`, `ip nat inside source static ${pc2} ${ip(O + 10)}`];

  const spec: Spec = {
    devices: [
      { name: "R1", model: "2911" },
      { name: "ISP", model: "2911" },
      { name: "S1", model: "2960-24TT" },
      { name: "PC1", model: "PC-PT" },
      { name: "PC2", model: "PC-PT" },
      { name: "WEB1", model: "Server-PT" },
    ],
    links: [
      link("R1", G("0/0"), "S1", G("0/1")),
      link("PC1", F("0"), "S1", F("0/1")),
      link("PC2", F("0"), "S1", F("0/2")),
      link("R1", G("0/1"), "ISP", G("0/0")),
      link("ISP", G("0/1"), "WEB1", F("0")),
    ],
    ios: [
      {
        name: "R1",
        commands: [
          "hostname R1",
          ...iface(G("0/0"), `ip address ${gwIn} ${mask(inside.prefix)}`, "ip nat inside", "no shutdown"),
          ...iface(G("0/1"), `ip address ${r1Out} 255.255.255.252`, "ip nat outside", "no shutdown"),
          `ip route 0.0.0.0 0.0.0.0 ${ispIn}`,
          ...nat,
        ],
      },
      {
        name: "ISP",
        commands: [
          "hostname ISP",
          ...iface(G("0/0"), `ip address ${ispIn} 255.255.255.252`, "no shutdown"),
          ...iface(G("0/1"), `ip address ${ispWeb} 255.255.255.0`, "no shutdown"),
          ...(type === "pat" ? [] : [`ip route ${block} ${r1Out}`]),
        ],
      },
      { name: "S1", commands: ["hostname S1"] },
    ],
    pcs: [
      { name: "PC1", ip: pc1, mask: mask(inside.prefix), gateway: gwIn },
      { name: "PC2", ip: pc2, mask: mask(inside.prefix), gateway: gwIn },
      { name: "WEB1", ip: webIp, mask: "255.255.255.0", gateway: ispWeb },
    ],
  };

  const design = [
    `Inside ${cidr(inside)}: PC1 ${pc1}, PC2 ${pc2} on S1 (2960-24TT); gateway R1 (2911) ${G("0/0")} ${gwIn} (ip nat inside).`,
    `Outside ${cidr(outside)}: R1 ${G("0/1")} ${r1Out}/30 (ip nat outside) <-> ISP (2911) ${G("0/0")} ${ispIn}/30; R1 has a default route to ISP.`,
    `"Internet": ISP ${G("0/1")} ${ispWeb}/24 <-> WEB1 (Server-PT) ${webIp}. ISP has no route to ${cidr(inside)}, so only translated traffic gets replies.`,
    type === "pat"
      ? `PAT: ACL 1 (${cidr(inside)}) overloaded on R1 ${G("0/1")} (${r1Out}).`
      : type === "dynamic"
        ? `Dynamic NAT: ACL 1 (${cidr(inside)}) -> pool PUBLIC ${ip(O + 9)}-${ip(O + 14)}; ISP routes ${ip(O + 8)}/29 to R1.`
        : `Static NAT: PC1 ${pc1} <-> ${ip(O + 9)}, PC2 ${pc2} <-> ${ip(O + 10)}; ISP routes ${ip(O + 8)}/29 to R1.`,
  ];
  const verify = [
    `From PC1 ping ${webIp} (WEB1); optionally open Desktop > Web Browser at http://${webIp}.`,
    "R1: show ip nat translations, show ip nat statistics.",
    type === "pat"
      ? `Both PCs appear as ${r1Out} with different ports.`
      : type === "dynamic"
        ? `Each PC gets a pool address from ${ip(O + 9)}; translations appear only after inside traffic.`
        : `From WEB1 ping ${ip(O + 9)}: it reaches PC1 through the static mapping.`,
  ];
  return lab({ goal: "Build a NAT lab in Cisco Packet Tracer with the packet-tracer-mcp tools.", notes, design, spec, verify });
}

// ---------- registration ----------

const arg = (description: string) => z.string().optional().describe(description);
const pick = (description: string, options: readonly string[]) =>
  completable(arg(description), (v) => options.filter((o) => o.startsWith((v ?? "").trim().toLowerCase())));

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "vlan_lab",
    {
      title: "VLAN lab",
      description:
        "Step-by-step build of a VLAN lab: a 2960 access switch, PCs per VLAN and optional inter-VLAN routing " +
        "(router-on-a-stick on a 2911 or SVIs on a 3560), with the full IOS configuration and addressing.",
      argsSchema: {
        vlans: arg("Comma-separated VLAN IDs, 2-1001, up to 6. Default 10,20,30."),
        hosts_per_vlan: pick("PCs per VLAN, 1-4. Default 2.", ["1", "2", "3", "4"]),
        inter_vlan: pick("router-on-a-stick (default), l3-switch or none.", INTER_VLAN),
      },
    },
    (a) => vlanLab(a)
  );

  server.registerPrompt(
    "ospf_lab",
    {
      title: "OSPF lab",
      description:
        "Step-by-step build of a single-area OSPF lab: 2911 routers in a chain or ring, one PC LAN per router, " +
        "with /30 transit links, router IDs and network statements.",
      argsSchema: {
        routers: pick("Number of routers, 2-6. Default 3.", ["2", "3", "4", "5", "6"]),
        area: arg("OSPF area ID (number or dotted). Default 0."),
        topology: pick("chain (default) or ring (3+ routers).", ["chain", "ring"]),
      },
    },
    (a) => ospfLab(a)
  );

  server.registerPrompt(
    "dhcp_lab",
    {
      title: "DHCP lab",
      description:
        "Step-by-step build of a DHCP lab: a 2911 gateway, a 2960 switch and DHCP-client PCs, served by an IOS DHCP " +
        "pool on the router or by a Server-PT.",
      argsSchema: {
        network: arg("LAN network in CIDR, /8-/30. Default 192.168.10.0/24."),
        dhcp_server: pick("router (IOS DHCP pool, default) or server (Server-PT DHCP service, set by hand).", ["router", "server"]),
        hosts: arg("Number of DHCP client PCs, 1-20. Default 3."),
      },
    },
    (a) => dhcpLab(a)
  );

  server.registerPrompt(
    "nat_lab",
    {
      title: "NAT lab",
      description:
        "Step-by-step build of a NAT lab: inside PCs behind a 2911 edge router, an ISP router and a web server, with PAT, " +
        "static or dynamic NAT, the ACL and the routes.",
      argsSchema: {
        nat_type: pick("pat (default, overload on the outside interface), static or dynamic (address pool).", ["pat", "static", "dynamic"]),
        inside_network: arg("Inside network in CIDR, /8-/28. Default 192.168.1.0/24."),
        outside_network: arg("Outside network in CIDR, /8-/28; the lab uses its first 16 addresses. Default 203.0.113.0/24."),
      },
    },
    (a) => natLab(a)
  );
}
