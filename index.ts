#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Topology } from "./topology.js";
import { generatePTBuilderScript } from "./ptbuilder.js";

const topo = new Topology();
const server = new McpServer({ name: "packet-tracer-mcp", version: "0.1.0" });

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const safe = (fn: () => string) => {
  try {
    return text(fn());
  } catch (e) {
    return { ...text(`Error: ${(e as Error).message}`), isError: true };
  }
};

const cable = z
  .enum(["straight", "cross", "roll", "fiber", "serial", "console", "auto", "phone", "coaxial", "wireless"])
  .default("auto");

server.tool(
  "add_device",
  "Agrega un dispositivo (ej. model: 2911, 2960-24TT, PC-PT, Server-PT, Laptop-PT).",
  { name: z.string(), model: z.string(), x: z.number().default(100), y: z.number().default(100) },
  async (a) => safe(() => (topo.addDevice(a), `Agregado ${a.name} (${a.model})`))
);

server.tool(
  "add_link",
  "Conecta dos dispositivos. Puertos como en PT, ej. GigabitEthernet0/0 o FastEthernet0.",
  { dev1: z.string(), port1: z.string(), dev2: z.string(), port2: z.string(), cable },
  async (a) => safe(() => (topo.addLink(a), `Enlace ${a.dev1}:${a.port1} <-> ${a.dev2}:${a.port2}`))
);

server.tool(
  "configure_device",
  "Agrega comandos IOS a un router o switch (se aplican en orden).",
  { name: z.string(), ios_commands: z.array(z.string()) },
  async (a) => safe(() => (topo.configureIos({ name: a.name, commands: a.ios_commands }), `Configurado ${a.name}`))
);

server.tool(
  "configure_pc",
  "Configura IP de un PC/Server/Laptop (estática o DHCP).",
  {
    name: z.string(),
    dhcp: z.boolean().default(false),
    ip: z.string().optional(),
    mask: z.string().optional(),
    gateway: z.string().optional(),
    dns: z.string().optional(),
  },
  async (a) => safe(() => (topo.configurePc(a), `IP configurada en ${a.name}`))
);

server.tool(
  "build_topology",
  "Reemplaza la topología completa a partir de una especificación estructurada.",
  {
    devices: z.array(z.object({ name: z.string(), model: z.string(), x: z.number(), y: z.number() })),
    links: z.array(
      z.object({ dev1: z.string(), port1: z.string(), dev2: z.string(), port2: z.string(), cable })
    ),
    ios: z.array(z.object({ name: z.string(), commands: z.array(z.string()) })).default([]),
  },
  async (a) =>
    safe(() => {
      topo.reset();
      a.devices.forEach((d) => topo.addDevice(d));
      a.links.forEach((l) => topo.addLink(l));
      a.ios.forEach((c) => topo.configureIos(c));
      return `Topología creada: ${a.devices.length} dispositivos, ${a.links.length} enlaces`;
    })
);

server.tool("get_topology", "Devuelve la topología actual en JSON.", {}, async () =>
  safe(() => JSON.stringify(topo.toJSON(), null, 2))
);

server.tool("validate_config", "Detecta puertos duplicados y dispositivos sin enlaces.", {}, async () =>
  safe(() => {
    const issues = topo.validate();
    return issues.length ? issues.join("\n") : "Sin problemas detectados";
  })
);

server.tool(
  "generate_script",
  "Genera el script PTBuilder. Pegar en Packet Tracer: Extensions > Builder Code Editor > Run.",
  {},
  async () => safe(() => generatePTBuilderScript(topo))
);

server.tool("reset_topology", "Limpia la topología.", {}, async () =>
  safe(() => (topo.reset(), "Topología vacía"))
);

await server.connect(new StdioServerTransport());
