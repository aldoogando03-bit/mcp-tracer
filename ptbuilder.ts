import { Topology } from "./topology.js";

const q = (s: string) => JSON.stringify(s);

/** Genera el script para pegar en Packet Tracer: Extensions > Builder Code Editor > Run. */
export function generatePTBuilderScript(t: Topology): string {
  const out: string[] = ["// Generado por packet-tracer-mcp"];

  for (const d of t.devices.values()) {
    out.push(`addDevice(${q(d.name)}, ${q(d.model)}, ${d.x}, ${d.y});`);
  }
  for (const l of t.links) {
    out.push(`addLink(${q(l.dev1)}, ${q(l.port1)}, ${q(l.dev2)}, ${q(l.port2)}, ${q(l.cable)});`);
  }
  for (const [name, cmds] of t.configs) {
    out.push(`configureIosDevice(${q(name)}, ${q(cmds.join("\n"))});`);
  }
  for (const p of t.pcIps.values()) {
    out.push(
      `configurePcIp(${q(p.name)}, ${p.dhcp}, ${q(p.ip ?? "")}, ${q(p.mask ?? "")}, ${q(p.gateway ?? "")}, ${q(p.dns ?? "")});`
    );
  }
  return out.join("\n");
}
