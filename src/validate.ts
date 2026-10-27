/**
 * Topology checks run by validate_config and generate_script. Pure, no MCP imports. Defensive: topologies loaded
 * from JSON or edited directly may hold states the Topology mutators reject. Rules: docs/PTBUILDER_API.md §2-§6.
 */
import {
  CABLE_NEEDS, UNVERIFIED_CABLES, cableFitsLink, expectedEthernetCable, inferCable, linkPortsCompatible, possiblePortKinds,
} from "./cables.js";
import {
  PTBUILDER_MODELS, findPort, formatPorts, getModelInfo, isIosModel, normalizePort, portKey, suggestModels, type ModelInfo,
  type PortKind,
} from "./catalog.js";
import { intToIp, maskToPrefix, parseIpv4 } from "./ipv4.js";
import { fmtLink, type Link, type Topology } from "./topology.js";

export type Issue = { severity: "error" | "warning"; code: string; message: string; device?: string };

const endKey = (dev: string, port: string) => `${dev.toLowerCase()}:${portKey(port)}`;
const list = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

const KIND_LABEL: Record<PortKind, string> = {
  fastethernet: "FastEthernet", gigabitethernet: "GigabitEthernet", ethernet: "Ethernet", serial: "Serial", fiber: "fiber",
  console: "Console", rs232: "RS232", aux: "Aux", modem: "modem", coaxial: "coaxial", wireless: "wireless", other: "unknown",
};

/** Catalogued model to suggest instead of an uncatalogued one of the same category. */
const PREFERRED: Partial<Record<string, string>> = { router: "2911", switch: "2960-24TT", l3switch: "3560-24PS" };

/** Prefix length of a dotted subnet mask, or undefined when it isn't one. */
function prefixLength(s: string | undefined): number | undefined {
  const v = parseIpv4(s);
  return v === undefined ? undefined : maskToPrefix(v);
}

/** `ip address A M [secondary]` lines per interface (last primary wins, as in IOS). */
function iosAddresses(commands: string[]): { ip: string; where: string }[] {
  const primary = new Map<string, string>();
  const out: { ip: string; where: string }[] = [];
  let iface = "";
  for (const raw of commands) {
    const line = raw.trim().replace(/\s+/g, " ");
    const intf = /^interface (.+)$/i.exec(line);
    if (intf) {
      iface = /^range /i.test(intf[1]) ? "" : normalizePort(intf[1]);
      continue;
    }
    const m = /^ip address (\S+) (\S+)( secondary)?$/i.exec(line);
    if (!m || parseIpv4(m[1]) === undefined) continue;
    if (m[3]) out.push({ ip: m[1], where: iface });
    else primary.set(iface, m[1]);
  }
  return [...[...primary].map(([where, ip]) => ({ ip, where })), ...out];
}

export function validate(t: Topology): { errors: Issue[]; warnings: Issue[] } {
  const issues: Issue[] = [];
  const add = (severity: Issue["severity"], code: string, message: string, device?: string) =>
    issues.push({ severity, code, message, ...(device !== undefined ? { device } : {}) });
  const error = (code: string, message: string, device?: string) => add("error", code, message, device);
  const warn = (code: string, message: string, device?: string) => add("warning", code, message, device);

  if (!t.devices.size) {
    warn("EMPTY_TOPOLOGY", "The topology has no devices, so the script would do nothing. Add devices with add_device or build_topology.");
  }

  /** Devices whose model is a PTBuilder key, with their catalog info (undefined = uncatalogued). */
  const known = new Map<string, ModelInfo | undefined>();
  const noPortData = new Set<string>();
  for (const d of t.devices.values()) {
    if (!PTBUILDER_MODELS.has(d.model)) {
      error(
        "UNKNOWN_MODEL",
        `${d.name}: "${d.model}" is not a PTBuilder model key, so addDevice would fail and later commands for ${d.name} ` +
          `would abort the script. Closest keys: ${suggestModels(d.model, 3).join(", ")}.`,
        d.name
      );
      continue;
    }
    const info = getModelInfo(d.model);
    known.set(d.name, info);
    if (!info || info.portsVerified === "unknown") {
      noPortData.add(d.name);
      const alt = info && PREFERRED[info.category];
      warn(
        "UNCATALOGUED_MODEL",
        `${d.name} (${d.model}) is a valid PTBuilder model, but this server has no port data for it: its port names and ` +
          `cables are not checked.${alt ? ` Prefer ${alt} if any ${info.category === "l3switch" ? "multilayer switch" : info.category} will do.` : ""}`,
        d.name
      );
    }
    if (d.model === "3650-24PS") {
      warn(
        "POWER_3650",
        `${d.name}: the 3650-24PS ships without a power supply in Packet Tracer and PTBuilder cannot add one, so it may stay ` +
          "powered off. Prefer 3560-24PS.",
        d.name
      );
    }
  }

  // Links.
  const portUse = new Map<string, { dev: string; port: string; links: Link[] }>();
  const unverified = new Map<string, Set<string>>();
  for (const l of t.links) {
    const ends = [[l.dev1, l.port1], [l.dev2, l.port2]] as const;
    const missing = ends.map(([dev]) => dev).filter((dev) => !t.devices.has(dev));
    if (missing.length) {
      for (const dev of new Set(missing)) {
        const near = t.getDevice(dev);
        error("UNKNOWN_DEVICE", `Link ${fmtLink(l)}: device "${dev}" does not exist${near ? ` (did you mean ${near.name}?)` : ""}.`, dev);
      }
      continue;
    }
    for (const [dev, port] of ends) {
      const k = endKey(dev, port);
      const use = portUse.get(k) ?? { dev, port, links: [] };
      if (!use.links.includes(l)) use.links.push(l);
      portUse.set(k, use);
    }
    if (l.dev1 === l.dev2) {
      error(
        "SELF_LINK",
        l.port1 === l.port2 || portKey(l.port1) === portKey(l.port2)
          ? `${fmtLink(l)} links a port to itself. Remove it with remove_link.`
          : `${fmtLink(l)} connects ${l.dev1} to itself. Packet Tracer refuses a cable between two ports of the same switch, ` +
              "and a link back to the same device is almost always a mistake. Link to another device.",
        l.dev1
      );
      continue;
    }
    if (!known.has(l.dev1) || !known.has(l.dev2)) continue; // UNKNOWN_MODEL already reported.

    const infoA = known.get(l.dev1);
    const infoB = known.get(l.dev2);
    let portsOk = true;
    const skipVerify = new Set<string>();
    for (const [dev, port, info] of [[l.dev1, l.port1, infoA], [l.dev2, l.port2, infoB]] as const) {
      if (!info || noPortData.has(dev)) continue;
      const listed = findPort(info, port);
      const serial = possiblePortKinds(info, port)[0] === "serial";
      const model = t.devices.get(dev)!.model;
      if (!listed && (info.portsVerified === "verified" || info.portsVerified === "partial")) {
        portsOk = false;
        const hint = serial && info.category === "router" ? " Serial ports need a WIC/HWIC/NIM module, which this server cannot add yet." : "";
        error("PORT_NOT_FOUND", `${dev} (${model}) has no port "${port}" (link ${fmtLink(l)}). Available ports: ${formatPorts(info.ports)}.${hint}`, dev);
        continue;
      }
      if (serial && info.category === "router" && !info.ports.some((p) => p.kind === "serial")) {
        skipVerify.add(dev);
        const module = model.startsWith("ISR") ? "NIM-2T" : "WIC/HWIC (e.g. HWIC-2T)";
        warn(
          "SERIAL_NEEDS_MODULE",
          `${dev} (${model}) has no onboard serial ports: ${port} needs a ${module} module, which this server cannot add yet, ` +
            "so addLink would fail. Use Ethernet ports between routers.",
          dev
        );
      }
      if (!skipVerify.has(dev) && !listed?.verified) {
        const set = unverified.get(dev) ?? new Set<string>();
        unverified.set(dev, set.add(port));
      }
    }
    if (!portsOk) continue;

    if (!linkPortsCompatible(infoA, l.port1, infoB, l.port2)) {
      const [ka, kb] = [possiblePortKinds(infoA, l.port1)[0], possiblePortKinds(infoB, l.port2)[0]];
      const hint =
        ka === "wireless" || kb === "wireless"
          ? "Wireless connections form by association, not by cable: remove this link."
          : [ka, kb].every((k) => ["console", "aux", "rs232"].includes(k))
            ? "A console cable joins a PC's RS232 port to a router or switch Console port."
            : [ka, kb].includes("serial")
              ? "Serial ports link only to Serial ports; use Ethernet ports on both ends."
              : "Use ports of the same kind on both ends.";
      error("PORT_KIND_MISMATCH", `${fmtLink(l)} joins a ${KIND_LABEL[ka]} port to a ${KIND_LABEL[kb]} port, and no cable connects these. ${hint}`, l.dev1);
      continue;
    }

    if (!l.cable) continue;
    const inferred = inferCable(infoA, l.port1, infoB, l.port2);
    const omit = `Omit cable to let the server infer it (${inferred}).`;
    if (!cableFitsLink(l.cable, infoA, l.port1, infoB, l.port2)) {
      const kinds = `${KIND_LABEL[possiblePortKinds(infoA, l.port1)[0]]} and ${KIND_LABEL[possiblePortKinds(infoB, l.port2)[0]]}`;
      const needs = Object.hasOwn(CABLE_NEEDS, l.cable) ? `it needs ${CABLE_NEEDS[l.cable]} ports` : "it is not a PTBuilder cable type";
      error("CABLE_INCOMPATIBLE", `${fmtLink(l)}: a ${l.cable} cable cannot join ${kinds} ports; ${needs}. ${omit}`, l.dev1);
    } else if (UNVERIFIED_CABLES.has(l.cable)) {
      warn("CABLE_UNVERIFIED", `${fmtLink(l)}: the "${l.cable}" cable's behaviour through PTBuilder's addLink is unverified. ${omit}`, l.dev1);
    } else if (l.cable === "straight" || l.cable === "cross") {
      const expected = expectedEthernetCable(infoA, l.port1, infoB, l.port2);
      if (expected && expected !== l.cable) {
        warn(
          "CABLE_SUSPICIOUS",
          `${fmtLink(l)}: ${l.cable} cable, but Packet Tracer expects ${expected} here (straight between unlike devices such as ` +
            "router/host/AP <-> switch/hub, cross between like devices and from an AP to a router/host). The link may stay down. " +
            omit,
          l.dev1
        );
      }
    }
  }

  for (const use of portUse.values()) {
    if (use.links.length > 1) {
      error(
        "DUPLICATE_PORT",
        `${use.dev}:${use.port} is used by ${use.links.length} links (${use.links.map(fmtLink).join("; ")}). A port takes one cable: ` +
          "move the extra links to free ports.",
        use.dev
      );
    }
  }

  for (const [dev, ports] of unverified) {
    const names = [...ports];
    warn(
      "UNVERIFIED_PORT",
      `${dev} (${t.devices.get(dev)!.model}): port name${names.length > 1 ? "s" : ""} ${list(names)} ${names.length > 1 ? "are" : "is"} ` +
        "unverified in Packet Tracer; if PT names a port differently, its addLink fails silently.",
      dev
    );
  }

  for (const d of t.devices.values()) {
    if (!t.links.some((l) => l.dev1 === d.name || l.dev2 === d.name)) warn("ISOLATED_DEVICE", `${d.name} has no links.`, d.name);
  }

  // IOS configuration.
  const addresses: { ip: string; who: string; device: string }[] = [];
  for (const [name, cmds] of t.configs) {
    if (!cmds.length) continue;
    const d = t.devices.get(name);
    if (!d) {
      error("UNKNOWN_DEVICE", `IOS commands are stored for "${name}", which does not exist; configureIosDevice would throw and abort the script.`, name);
      continue;
    }
    if (!isIosModel(d.model)) {
      error(
        "IOS_ON_NON_IOS",
        `${name} (${d.model}) has IOS commands, but configureIosDevice only works on routers, switches and multilayer switches: ` +
          `here it would throw and abort the rest of the script.${getModelInfo(d.model)?.pcIp ? " Set its IP with configure_pc instead." : ""}`,
        name
      );
      continue;
    }
    for (const a of iosAddresses(cmds)) addresses.push({ ip: a.ip, who: a.where ? `${name} ${a.where}` : name, device: name });
  }

  // Host IP configuration.
  for (const [name, pc] of t.pcIps) {
    const d = t.devices.get(name);
    if (!d) {
      error("UNKNOWN_DEVICE", `IP configuration is stored for "${name}", which does not exist; configurePcIp would throw and abort the script.`, name);
      continue;
    }
    const info = getModelInfo(d.model);
    if (!info?.pcIp) {
      error(
        "PCIP_ON_NON_HOST",
        `${name} (${d.model}) has a host IP configuration, but configurePcIp only works on hosts with a FastEthernet0 NIC ` +
          "(PC-PT, Server-PT): it would throw and abort the script. Configure routers and switches with configure_device.",
        name
      );
      continue;
    }
    if (!findPort(info, "FastEthernet0")?.verified) {
      warn(
        "PCIP_UNVERIFIED_PORT",
        `${name} (${d.model}): configurePcIp writes to FastEthernet0, which is unverified on this model; if it is missing, ` +
          "the call throws and aborts the rest of the script. Prefer PC-PT or Server-PT.",
        name
      );
    }
    const bad = (["ip", "mask", "gateway", "dns"] as const).filter((k) => {
      const v = pc[k];
      if (!v || (pc.dhcp && k !== "dns")) return false;
      return k === "mask" ? prefixLength(v) === undefined : parseIpv4(v) === undefined;
    });
    for (const k of bad) {
      error(
        "INVALID_IP",
        `${name}: ${k} "${pc[k]}" is not a valid ${k === "mask" ? "dotted subnet mask (e.g. 255.255.255.0)" : "IPv4 address"}. Fix it with configure_pc.`,
        name
      );
    }
    if (pc.dhcp) continue;
    if (!pc.ip || !pc.mask) {
      const missing = [!pc.ip && "ip", !pc.mask && "mask"].filter(Boolean).join(" and ");
      error(
        "PCIP_STATIC_INCOMPLETE",
        `${name}: static IP configuration without ${missing}; PTBuilder silently skips the address unless both are set. ` +
          "Call configure_pc with ip and mask, or dhcp: true.",
        name
      );
      continue;
    }
    if (bad.includes("ip") || bad.includes("mask")) continue;
    addresses.push({ ip: pc.ip, who: name, device: name });
    const ip = parseIpv4(pc.ip)!;
    const prefix = prefixLength(pc.mask)!;
    const mask = parseIpv4(pc.mask)!;
    const subnet = `${intToIp((ip & mask) >>> 0)}/${prefix}`;
    if (!pc.gateway) {
      warn(
        "HOST_STATIC_NO_GATEWAY",
        `${name}: static IP ${pc.ip}/${prefix} with no default gateway, so it can reach only ${subnet}. ` +
          "Add a gateway with configure_pc if it must reach other networks.",
        name
      );
    } else if (!bad.includes("gateway") && ((parseIpv4(pc.gateway)! & mask) >>> 0) !== ((ip & mask) >>> 0)) {
      warn(
        "GATEWAY_NOT_IN_SUBNET",
        `${name}: gateway ${pc.gateway} is outside its subnet ${subnet} (${pc.ip} ${pc.mask}), so the host cannot reach it. ` +
          `Use an address in ${subnet}, normally the router interface on that LAN.`,
        name
      );
    }
  }

  const byIp = new Map<string, typeof addresses>();
  for (const a of addresses) byIp.set(a.ip, [...(byIp.get(a.ip) ?? []), a]);
  for (const [ip, users] of byIp) {
    if (users.length > 1) {
      warn("DUPLICATE_IP", `${ip} is assigned to ${list(users.map((u) => u.who))}. Every interface needs its own address.`, users[0].device);
    }
  }

  return { errors: issues.filter((i) => i.severity === "error"), warnings: issues.filter((i) => i.severity === "warning") };
}

/** LLM-friendly validate_config report: "Errors (n)" / "Warnings (n)" sections with codes, or "No issues found." */
export function formatValidation({ errors, warnings }: { errors: Issue[]; warnings: Issue[] }): string {
  if (!errors.length && !warnings.length) return "No issues found.";
  const section = (title: string, items: Issue[]) =>
    items.length ? [`${title} (${items.length}):`, ...items.map((i) => `- [${i.code}] ${i.message}`)] : [];
  return [
    ...section("Errors", errors),
    ...(errors.length && warnings.length ? [""] : []),
    ...section("Warnings", warnings),
    "",
    errors.length
      ? "Errors block generate_script (force: true overrides); warnings do not."
      : "No errors: generate_script will run. Warnings point at things that may not work in Packet Tracer.",
  ].join("\n");
}
