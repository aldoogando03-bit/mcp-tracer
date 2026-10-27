# packet-tracer-mcp

MCP server para que cualquier agente (Claude, etc.) diseñe topologías de Cisco Packet Tracer.
Genera scripts **PTBuilder** listos para ejecutar dentro de PT.

## Instalación

```bash
npm install
npm run build
```

## Conectar a un cliente MCP

```json
{
  "mcpServers": {
    "packet-tracer": {
      "command": "node",
      "args": ["/ruta/a/packet-tracer-mcp/build/index.js"]
    }
  }
}
```

En Claude Code: `claude mcp add packet-tracer -- node /ruta/a/packet-tracer-mcp/build/index.js`

## Tools

| Tool | Qué hace |
|---|---|
| `add_device` | Agrega router, switch, PC, server |
| `add_link` | Conecta dos dispositivos con un tipo de cable |
| `configure_device` | Comandos IOS para routers/switches |
| `configure_pc` | IP estática o DHCP en equipos finales |
| `build_topology` | Crea toda la topología de una vez |
| `get_topology` | Estado actual en JSON |
| `validate_config` | Puertos duplicados, dispositivos aislados |
| `generate_script` | Script PTBuilder |
| `reset_topology` | Limpia todo |

## Usar el script en Packet Tracer

1. Pide al agente: "genera el script de la topología".
2. En PT: **Extensions > Builder Code Editor**, pega el script y pulsa **Run**.

## Roadmap

- [ ] Ruta 2: puente local con Script Module para control en vivo
- [ ] Plantillas (VLANs, OSPF, DHCP, NAT)
- [ ] Exportar a imagen de la topología

## Licencia

MIT
