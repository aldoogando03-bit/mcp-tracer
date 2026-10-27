import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CABLE_TYPES, resolveCable } from "../cables.js";
import { CATALOG, findPort, formatPorts, getModelInfo, type Category } from "../catalog.js";
import { layoutPositions } from "../layout.js";
import { issueReport, plural, renderScript } from "../render.js";
import type { Session } from "../session.js";
import { Topology, type Link } from "../topology.js";
import { formatValidation, validate } from "../validate.js";
import { safe, text } from "./util.js";

const keys = (...cats: Category[]) => CATALOG.filter((m) => cats.includes(m.category)).map((m) => m.model).join(", ");

const MODELS =
  `Routers: ${keys("router")}. Switches: ${keys("switch")}. Multilayer switches: 3560-24PS (preferred), 3650-24PS ` +
  `(ships without a power supply in PT). Hosts: ${keys("host")}. Other: ${keys("hub", "cloud", "wireless", "firewall", "phone")}.`;

const CABLING = new Set(["fastethernet", "gigabitethernet", "ethernet"]);
const PORTS = CATALOG.filter((m) => ["router", "switch", "l3switch", "host"].includes(m.category))
  .map((m) => `${m.model}: ${formatPorts(m.ports.filter((p) => CABLING.has(p.kind)))}${m.portsVerified === "unverified" ? " (unverified)" : ""}`)
  .join("; ");

const name = z.string().min(1).describe("Device name, e.g. R1, S1, PC1 (case-insensitive).");
const port = z.string().min(1).describe("Interface name, e.g. GigabitEthernet0/0, FastEthernet0/1, FastEthernet0 (abbreviations such as Gi0/0 are expanded).");
const coord = (axis: string) =>
  z.number().optional().describe(`${axis} coordinate on the Packet Tracer logical workspace. Omit both x and y for automatic placement.`);
const model = z
  .string()
  .min(1)
  .describe('PTBuilder model key, e.g. 2911, 2960-24TT, PC-PT. Aliases such as "4331", "WRT300N" or "PC" are resolved.');
const cable = z
  .enum(CABLE_TYPES)
  .optional()
  .describe('Cable type. Omit it to let the server infer the right one (recommended). "auto" is passed to PT as-is and its behaviour is unverified.');
const iosCommands = z
  .array(z.string())
  .describe('IOS commands in global configuration mode, one per item, e.g. ["hostname R1", "interface GigabitEthernet0/0", "ip address 192.168.1.1 255.255.255.0", "no shutdown", "exit"].');
const pcFields = {
  name,
  dhcp: z.boolean().default(false).describe("true = obtain the address by DHCP (ip/mask/gateway are ignored)."),
  ip: z.string().optional().describe("IPv4 address, e.g. 192.168.1.10 (or 192.168.1.10/24 to include the mask)."),
  mask: z.string().optional().describe("Subnet mask, e.g. 255.255.255.0 or /24."),
  gateway: z.string().optional().describe("Default gateway IPv4 address."),
  dns: z.string().optional().describe("DNS server IPv4 address (kept with DHCP too)."),
};
const linkFields = { dev1: name, port1: port, dev2: name, port2: port, cable };

const fmtLink = (l: Link) => `${l.dev1}:${l.port1} <-> ${l.dev2}:${l.port2}`;

function deviceDetails(modelKey: string): string[] {
  const info = getModelInfo(modelKey);
  if (!info) return [];
  const lines = info.ports.length ? [`Ports: ${formatPorts(info.ports)}${info.portsVerified === "unverified" ? " (names unverified)" : ""}.`] : [];
  return [...lines, ...(info.notes ?? []).map((n) => `Note: ${n}`)];
}

export function registerTopologyTools(server: McpServer, session: Session) {
  server.registerTool(
    "add_device",
    {
      title: "Add device",
      description:
        "Add a device to the topology. `model` must be a PTBuilder model key; common aliases are resolved and the result " +
        'shows the canonical key ("4331" -> ISR4331, "WRT300N" -> Linksys-WRT300N, "ASA5505" -> 5505, "IP Phone 7960" -> 7960, ' +
        `"PC" -> PC-PT). ${MODELS} The pt://catalog resource lists every accepted key and its ports. ` +
        "Names must be unique (case-insensitive). Omit x and y to place the device automatically. The result lists the device's ports.",
      inputSchema: { name, model, x: coord("X"), y: coord("Y") },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    (a) =>
      safe(() => {
        const d = session.topology.addDevice(a);
        const alias = d.model !== a.model ? ` (resolved from "${a.model}")` : "";
        const where = d.x !== undefined ? ` at (${d.x}, ${d.y})` : "; no x/y given, so its position will be auto-computed from its type and links";
        return [`Added ${d.name}: ${d.model}${alias}${where}.`, ...deviceDetails(d.model)].join("\n");
      })
  );

  server.registerTool(
    "add_link",
    {
      title: "Add link",
      description:
        "Connect two device ports with a cable. Use Packet Tracer interface names; abbreviations are expanded " +
        "(Gi0/0 -> GigabitEthernet0/0, Fa0/1 -> FastEthernet0/1, Se0/0/0 -> Serial0/0/0). Each port can belong to only one link. " +
        `Onboard ports: ${PORTS}. Routers have no onboard serial ports and modules cannot be added yet, so connect routers over Ethernet. ` +
        "Omit `cable` to let the server infer it: straight between unlike devices (router/host <-> switch/hub), cross between like " +
        "devices (switch-switch, router-router, router-PC, PC-PC), straight from an access point to a switch/hub and cross to a " +
        "router/host, serial for Serial ports, console for Console/RS232 ports.",
      inputSchema: linkFields,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    (a) =>
      safe(() => {
        const t = session.topology;
        const l = t.addLink(a);
        return `Linked ${fmtLink(l)} (cable: ${resolveCable(t, l)}${l.cable ? "" : ", inferred"}).`;
      })
  );

  server.registerTool(
    "remove_device",
    {
      title: "Remove device",
      description: "Remove a device together with its links, IOS commands and IP configuration.",
      inputSchema: { name },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    (a) =>
      safe(() => {
        const r = session.topology.removeDevice(a.name);
        const parts = [
          r.links.length ? `${plural(r.links.length, "link")} (${r.links.map(fmtLink).join("; ")})` : "",
          r.hadConfig ? "its IOS commands" : "",
          r.hadPcIp ? "its IP configuration" : "",
        ].filter(Boolean);
        return `Removed ${r.device.name} (${r.device.model})${parts.length ? ` and ${parts.join(", ")}` : ""}.`;
      })
  );

  server.registerTool(
    "remove_link",
    {
      title: "Remove link",
      description: "Remove the link that uses the given device port (a port belongs to at most one link).",
      inputSchema: { device: name, port },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    (a) => safe(() => `Removed link ${fmtLink(session.topology.removeLink(a.device, a.port))}.`)
  );

  server.registerTool(
    "rename_device",
    {
      title: "Rename device",
      description:
        "Rename a device; its links, IOS commands and IP configuration follow. IOS `hostname` commands are not changed " +
        "(use configure_device with replace: true to update them).",
      inputSchema: { name, new_name: z.string().min(1).describe("New unique device name.") },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    (a) =>
      safe(() => {
        const t = session.topology;
        const old = t.requireDevice(a.name).name;
        const d = t.renameDevice(a.name, a.new_name);
        const hostname = (t.configs.get(d.name) ?? []).some((c) => /^hostname\s/i.test(c));
        return `Renamed ${old} to ${d.name}.${hostname ? " Its IOS hostname command was not changed." : ""}`;
      })
  );

  server.registerTool(
    "configure_device",
    {
      title: "Configure IOS device",
      description:
        "Add IOS configuration commands to a router, switch or multilayer switch (not PCs, servers, ASAs, access points or " +
        "wireless routers). Commands run in GLOBAL CONFIGURATION MODE: do not send `enable`, `configure terminal`, `end` or " +
        "`write memory` (PTBuilder saves automatically); such lines are dropped and reported. Leave sub-modes (interface, " +
        "router ospf, line) with `exit`. Use full interface names (interface GigabitEthernet0/0). Commands are appended to " +
        "earlier ones; set replace: true to overwrite the device's previous commands. Invalid commands fail silently in PT.",
      inputSchema: {
        name,
        ios_commands: iosCommands,
        replace: z.boolean().default(false).describe("true = discard this device's previous commands first."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    (a) =>
      safe(() => {
        const r = session.topology.configureIos({ name: a.name, commands: a.ios_commands, replace: a.replace });
        const lines = [`${r.device.name}: ${a.replace ? "set" : "added"} ${plural(r.added.length, "IOS command")} (${r.total} total).`];
        if (r.dropped.length) {
          lines.push(`Dropped ${plural(r.dropped.length, "line")} (PTBuilder starts in global config mode and saves automatically): ${r.dropped.join(" | ")}`);
        }
        return lines.join("\n");
      })
  );

  server.registerTool(
    "configure_pc",
    {
      title: "Configure host IP",
      description:
        "Set the IPv4 configuration of a host: PC-PT and Server-PT (Laptop-PT and Printer-PT are accepted but unverified). " +
        "PTBuilder configures only the FastEthernet0 interface. dhcp: true enables DHCP (ip, mask and gateway are ignored; " +
        "dns is kept). Otherwise ip and mask are required; mask accepts 255.255.255.0 or /24. Replaces the host's previous IP " +
        "configuration. For routers and switches use configure_device instead.",
      inputSchema: pcFields,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    (a) =>
      safe(() => {
        const t = session.topology;
        const { pc, ignored } = t.configurePc(a);
        const desc = pc.dhcp
          ? `DHCP${pc.dns ? `, DNS ${pc.dns}` : ""}`
          : `${pc.ip} ${pc.mask}${pc.gateway ? `, gateway ${pc.gateway}` : ""}${pc.dns ? `, DNS ${pc.dns}` : ""}`;
        const lines = [`${pc.name}: ${desc}.`];
        if (ignored.length) lines.push(`Ignored with DHCP: ${ignored.join(", ")}.`);
        const d = t.requireDevice(pc.name);
        if (!findPort(getModelInfo(d.model), "FastEthernet0")?.verified) {
          lines.push(`Note: FastEthernet0 is unverified on ${d.model}; configurePcIp may fail in PT and abort the rest of the script.`);
        }
        return lines.join("\n");
      })
  );

  server.registerTool(
    "build_topology",
    {
      title: "Build topology",
      description:
        "Replace the whole topology in one call. Atomic: if any device, link, IOS block or host IP entry is invalid, nothing " +
        "changes and the error names the failing item. Same rules as add_device, add_link, configure_device and configure_pc " +
        "(models are resolved, ports normalized, cables inferred when omitted, IOS commands run in global configuration mode).",
      inputSchema: {
        devices: z.array(z.object({ name, model, x: coord("X"), y: coord("Y") })).describe("Devices to create."),
        links: z.array(z.object(linkFields)).default([]).describe("Links between device ports."),
        ios: z
          .array(z.object({ name, commands: iosCommands }))
          .default([])
          .describe("IOS commands per router/switch (global configuration mode)."),
        pcs: z.array(z.object(pcFields)).default([]).describe("Host IP configurations (as configure_pc)."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    (a) =>
      safe(() => {
        const { topology, notes } = Topology.fromSpec(a);
        session.replaceTopology(topology);
        return [
          `Topology built: ${plural(topology.devices.size, "device")}, ${plural(topology.links.length, "link")}, ` +
            `${plural(topology.configs.size, "IOS config")}, ${plural(topology.pcIps.size, "host IP config")}.`,
          ...notes,
        ].join("\n");
      })
  );

  server.registerTool(
    "get_topology",
    {
      title: "Get topology",
      description:
        "Return the current topology as JSON: devices (with the position that will be emitted; autoPlaced: true when the " +
        "auto layout computed it), links (with the cable that will be emitted), IOS commands and host IP configurations.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () =>
      safe(() => {
        const t = session.topology;
        const j = t.toJSON();
        const pos = layoutPositions(t);
        const devices = j.devices.map((d) => {
          const p = pos.get(d.name)!;
          return { name: d.name, model: d.model, x: p.x, y: p.y, autoPlaced: d.x === undefined || d.y === undefined };
        });
        const links = t.links.map((l) => ({ ...l, cable: resolveCable(t, l), ...(l.cable ? {} : { cableInferred: true }) }));
        return JSON.stringify({ ...j, devices, links }, null, 2);
      })
  );

  server.registerTool(
    "validate_config",
    {
      title: "Validate topology",
      description:
        "Check the topology before generate_script. Errors mean the PTBuilder script would fail or abort (e.g. PORT_KIND_MISMATCH, " +
        "CABLE_INCOMPATIBLE, DUPLICATE_PORT, IOS_ON_NON_IOS) and block generate_script; warnings mean it may not work as intended " +
        "in Packet Tracer (e.g. UNVERIFIED_PORT, CABLE_SUSPICIOUS, GATEWAY_NOT_IN_SUBNET, ISOLATED_DEVICE). Each issue has a code and a fix.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => safe(() => formatValidation(validate(session.topology)))
  );

  server.registerTool(
    "generate_script",
    {
      title: "Generate PTBuilder script",
      description:
        "Generate the PTBuilder JavaScript for the current topology. Tell the user to open a new, empty Packet Tracer workspace " +
        "(File > New), open Extensions > Builder Code Editor, paste the script and click Run. Runs validation first: errors block " +
        "generation unless force: true. The script is the first text block; warnings, if any, are a second text block.",
      inputSchema: { force: z.boolean().default(false).describe("Generate even if validation reports errors.") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (a) =>
      safe(() => {
        const r = renderScript(session.topology, { force: a.force });
        const report = issueReport(r);
        return report ? text(r.script, report) : text(r.script);
      })
  );

  server.registerTool(
    "reset_topology",
    {
      title: "Reset topology",
      description: "Delete every device, link and configuration.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    () => safe(() => (session.topology.reset(), "Topology cleared."))
  );
}
