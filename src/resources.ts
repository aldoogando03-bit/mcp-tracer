import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, McpError, type ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { CABLE_TYPES } from "./cables.js";
import { CATALOG, PTBUILDER_MODELS, getModelInfo, resolveModel, suggestModels, type ModelInfo } from "./catalog.js";
import { compactJson } from "./render.js";
import { VERSION } from "./version.js";

const CABLES: Record<string, string> = {
  straight: "Copper straight-through: unlike devices (router/host <-> switch/hub, access point <-> switch).",
  cross: "Copper cross-over: like devices (switch-switch, router-router, router-host, host-host, access point <-> router/host).",
  roll: "Rollover (ETHERNET_ROLL); how it differs from console is unverified.",
  fiber: "Fiber between fiber ports (SFP/GLC modules, which this server cannot add yet); SM/MM choice unverified.",
  serial: "Serial between Serial ports (routers need WIC/HWIC/NIM modules, not addable yet); which end is DCE is unverified.",
  console: "Console: PC RS232 <-> router/switch Console.",
  phone: "Phone line between modem ports (e.g. PC modem <-> Cloud-PT).",
  coaxial: "Coaxial between coaxial ports (e.g. cable modem <-> Cloud-PT).",
  auto: "PT's AUTO link type; behaviour through PTBuilder unverified. Prefer omitting the cable.",
  octal: "Octal: async module (HWIC-8A) <-> up to eight console ports.",
  usb: "USB, for IoE Things, MCU-PT and SBC-PT.",
  custom_io: "IoE custom I/O cable, for Things, MCU-PT and SBC-PT.",
};

const entry = (m: ModelInfo) => ({
  model: m.model,
  aliases: m.aliases,
  category: m.category,
  ios: m.ios,
  pcIp: m.pcIp,
  portsVerified: m.portsVerified,
  ports: m.ports.map((p) => [p.name, p.kind, p.verified]),
  ...(m.notes?.length ? { notes: m.notes } : {}),
});

const header = () => ({
  generatedBy: `mcp-tracer v${VERSION}`,
  ptbuilder: "https://github.com/kimmknight/PTBuilder",
  verification:
    'Nothing here was run in Packet Tracer. verified: false marks a port name that is unverified ("sin verificar" in ' +
    "docs/PTBUILDER_API.md §6). portsVerified: verified = every name confirmed; partial = count confirmed, unlisted " +
    "ports are rejected; unverified = names unconfirmed, unlisted ports accepted; unknown = no port data.",
  usage:
    "model is the exact PTBuilder key (add_device also resolves aliases). ios: accepts configure_device. pcIp: accepts " +
    "configure_pc (PTBuilder sets FastEthernet0 only). ports: [name, kind, verified].",
});

const json = (uri: URL, body: Record<string, unknown>): ReadResourceResult => ({
  contents: [{ uri: uri.href, mimeType: "application/json", text: compactJson(body) }],
});

const OTHER_MODELS = [...PTBUILDER_MODELS].filter((m) => !CATALOG.some((c) => c.model === m));

/** Model keys and aliases for completion, catalogued models first. */
const COMPLETIONS = [...new Set([...CATALOG.flatMap((m) => [m.model, ...m.aliases]), ...OTHER_MODELS])];

export function registerResources(server: McpServer): void {
  server.registerResource(
    "catalog",
    "pt://catalog",
    {
      title: "Packet Tracer device catalog",
      description:
        "PTBuilder model keys with category, IOS/host-IP support, onboard ports and their verification status, other valid " +
        "PTBuilder model keys without catalog data, and the cable types. Read before choosing models and ports.",
      mimeType: "application/json",
    },
    (uri) =>
      json(uri, {
        ...header(),
        models: CATALOG.map(entry),
        otherPtbuilderModels: OTHER_MODELS,
        otherModelsNote: "Valid addDevice keys with no port data: any port name is accepted and not checked. Prefer catalogued models.",
        cableTypes: CABLE_TYPES.map((c) => ({ type: c, description: CABLES[c] ?? "" })),
        cableNote: "Omit the cable in add_link/build_topology to let the server infer it.",
      })
  );

  server.registerResource(
    "catalog-model",
    new ResourceTemplate("pt://catalog/{model}", {
      list: undefined,
      complete: {
        model: (value) => {
          const v = value.toLowerCase();
          return COMPLETIONS.filter((m) => m.toLowerCase().startsWith(v)).slice(0, 100);
        },
      },
    }),
    {
      title: "Catalog entry for one model",
      description: "One model's catalog entry by PTBuilder key or alias, e.g. pt://catalog/2911 or pt://catalog/4331.",
      mimeType: "application/json",
    },
    (uri, vars) => {
      const raw = Array.isArray(vars.model) ? vars.model[0] : vars.model;
      let input = raw ?? "";
      try {
        input = decodeURIComponent(input);
      } catch {
        /* keep the raw value */
      }
      const r = input.trim() ? resolveModel(input) : undefined;
      if (!r) {
        // The SDK has no "resource not found" code (-32002); it uses InvalidParams for unknown resources too.
        const shown = input.length > 80 ? `${input.slice(0, 64)}...` : input;
        throw new McpError(ErrorCode.InvalidParams, `Unknown model "${shown}". Closest PTBuilder model keys: ${suggestModels(input).join(", ")}.`, {
          uri: uri.href,
        });
      }
      const resolvedFrom = r.model !== input ? { resolvedFrom: input } : {};
      if (r.info) return json(uri, { ...header(), ...resolvedFrom, ...entry(r.info) });
      const info = getModelInfo(r.model);
      return json(uri, {
        ...header(),
        ...resolvedFrom,
        model: r.model,
        catalogued: false,
        ...(info ? { category: info.category, ios: info.ios, pcIp: info.pcIp } : {}),
        portsVerified: "unknown",
        ports: [],
        notes: ["Valid PTBuilder model key without catalog data: port names are unknown and not checked."],
      });
    }
  );
}
