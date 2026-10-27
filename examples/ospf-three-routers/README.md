# OSPF with three routers

Three routers in a chain, running OSPF process 1 in area 0, with a switch and a PC behind each one. The routers are linked over Ethernet because routers have no serial ports in mcp-tracer yet.

| Router | GigabitEthernet0/0 (LAN, passive) | GigabitEthernet0/1 | GigabitEthernet0/2 | Router ID |
|---|---|---|---|---|
| R1 (`2911`) | 192.168.1.1/24 | 10.0.0.1/30 to R2 | | 1.1.1.1 |
| R2 (`2911`) | 192.168.2.1/24 | 10.0.0.2/30 to R1 | 10.0.0.5/30 to R3 | 2.2.2.2 |
| R3 (`2911`) | 192.168.3.1/24 | 10.0.0.6/30 to R2 | | 3.3.3.3 |

Each LAN N (1 to 3) has RN GigabitEthernet0/0 to SN (`2960-24TT`) GigabitEthernet0/1, and PCN (`PC-PT`) FastEthernet0 to SN FastEthernet0/1, with PCN at 192.168.N.10/24 and gateway 192.168.N.1. Every router advertises its LAN and its transit links with `network` statements and makes GigabitEthernet0/0 passive.

The server infers the cables: straight-through to the switches, cross-over between routers. Cross-over between routers is the classic rule, but that pairing has not been confirmed in a Packet Tracer run yet.

## Files

- `topology.json`: the topology in the `save_topology` file format.
- `script.js`: the PTBuilder script, generated from `topology.json` by `npm run examples`.

The examples live in the GitHub repository, not in the npm package. Clone the repository or download this folder.

## Use it

**With your agent.** Ask it to load the file, for example: "Load /path/to/mcp-tracer/examples/ospf-three-routers/topology.json and generate the script." The agent calls `load_topology`:

```json
{ "path": "/path/to/mcp-tracer/examples/ospf-three-routers/topology.json" }
```

Use an absolute path, or a path relative to `MCP_TRACER_DIR`. For more routers, a ring or another area, the `ospf_lab` prompt builds a variant for you.

**Without an agent.** Open `script.js` and copy all of it.

**In Packet Tracer:** File > New, then Extensions > Builder Code Editor. Paste the script, click **Run**, and wait until every link light is green (switch ports take about 30 seconds).

## Check that it works

- **Each router > CLI**: `show ip ospf neighbor` (R1 and R3 have one neighbor in FULL state, R2 has two) and `show ip route ospf` (routes to the other two 192.168.N.0/24 LANs).
- **PC1 > Desktop > Command Prompt**: `ping 192.168.3.10` (PC3) once OSPF has converged, about 40 seconds after the links come up.

## Validation

`validate_config` reports no errors and one warning:

```text
- [UNVERIFIED_PORT] R2 (2911): port name GigabitEthernet0/2 is unverified in Packet Tracer; if PT names a port differently, its addLink fails silently.
```

Packet Tracer documents three onboard Gigabit ports on the 2911, but only GigabitEthernet0/0 and 0/1 are confirmed by name. If the R2 to R3 link is missing after Run, that port name is the likely cause; please [report what Packet Tracer shows](https://github.com/aldoogando03-bit/mcp-tracer/issues/new?template=port_verification.yml).
