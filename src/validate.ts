/** Topology checks run by validate_config and generate_script. Pure, no MCP imports. */
import { PTBUILDER_MODELS, normalizePort } from "./catalog.js";
import type { Topology } from "./topology.js";

export type Issue = { severity: "error" | "warning"; code: string; message: string; device?: string };

export function validate(t: Topology): { errors: Issue[]; warnings: Issue[] } {
  const issues: Issue[] = [];
  const add = (severity: Issue["severity"], code: string, message: string, device?: string) =>
    issues.push({ severity, code, message, ...(device !== undefined ? { device } : {}) });

  for (const d of t.devices.values()) {
    if (!PTBUILDER_MODELS.has(d.model)) {
      add("error", "UNKNOWN_MODEL", `${d.name}: "${d.model}" is not a PTBuilder model key, so addDevice would fail.`, d.name);
    }
  }

  const used = new Set<string>();
  for (const l of t.links) {
    for (const [dev, port] of [[l.dev1, l.port1], [l.dev2, l.port2]]) {
      const key = `${dev.toLowerCase()}:${normalizePort(port).toLowerCase().replace(/\s+/g, "")}`;
      if (used.has(key)) add("error", "DUPLICATE_PORT", `${dev}:${port} is used by more than one link.`, dev);
      used.add(key);
    }
  }

  for (const name of t.devices.keys()) {
    if (!t.links.some((l) => l.dev1 === name || l.dev2 === name)) {
      add("warning", "ISOLATED_DEVICE", `${name} has no links.`, name);
    }
  }

  return { errors: issues.filter((i) => i.severity === "error"), warnings: issues.filter((i) => i.severity === "warning") };
}
