# VLANs with router-on-a-stick

Two VLANs on one switch, routed by a single router interface with 802.1Q subinterfaces.

| Device | Model | Connected to | Address |
|---|---|---|---|
| R1 | `2911` | GigabitEthernet0/0 to S1 GigabitEthernet0/1 (trunk) | GigabitEthernet0/0.10: 192.168.10.1/24, GigabitEthernet0/0.20: 192.168.20.1/24 |
| S1 | `2960-24TT` | | VLAN 10 `STAFF` on FastEthernet0/1-2, VLAN 20 `GUEST` on FastEthernet0/3-4 |
| PC1 | `PC-PT` | FastEthernet0 to S1 FastEthernet0/1 | 192.168.10.10/24, gateway 192.168.10.1 |
| PC2 | `PC-PT` | FastEthernet0 to S1 FastEthernet0/2 | 192.168.10.11/24, gateway 192.168.10.1 |
| PC3 | `PC-PT` | FastEthernet0 to S1 FastEthernet0/3 | 192.168.20.10/24, gateway 192.168.20.1 |
| PC4 | `PC-PT` | FastEthernet0 to S1 FastEthernet0/4 | 192.168.20.11/24, gateway 192.168.20.1 |

R1 brings up GigabitEthernet0/0 and uses `encapsulation dot1Q 10` and `encapsulation dot1Q 20` on its subinterfaces. S1 creates both VLANs, makes GigabitEthernet0/1 a trunk and assigns the access ports with `interface range`. All cables are straight-through, inferred by the server.

## Files

- `topology.json`: the topology in the `save_topology` file format.
- `script.js`: the PTBuilder script, generated from `topology.json` by `npm run examples`.

The examples live in the GitHub repository, not in the npm package. Clone the repository or download this folder.

## Use it

**With your agent.** Ask it to load the file, for example: "Load /path/to/mcp-tracer/examples/vlan-router-on-a-stick/topology.json and generate the script." The agent calls `load_topology`:

```json
{ "path": "/path/to/mcp-tracer/examples/vlan-router-on-a-stick/topology.json" }
```

Use an absolute path, or a path relative to `MCP_TRACER_DIR`. For other VLAN IDs, more PCs or a multilayer switch instead of the router, the `vlan_lab` prompt builds a variant for you.

**Without an agent.** Open `script.js` and copy all of it.

**In Packet Tracer:** File > New, then Extensions > Builder Code Editor. Paste the script, click **Run**, and wait until every link light is green (switch ports take about 30 seconds).

## Check that it works

- **S1 > CLI**: `show vlan brief` (FastEthernet0/1-2 in VLAN 10, FastEthernet0/3-4 in VLAN 20) and `show interfaces trunk` (GigabitEthernet0/1 trunking).
- **R1 > CLI**: `show ip interface brief` (GigabitEthernet0/0.10 and GigabitEthernet0/0.20 up/up).
- **PC1 > Desktop > Command Prompt**: `ping 192.168.10.11` (PC2, same VLAN), then `ping 192.168.20.10` (PC3, routed through R1). The first routed ping may time out while ARP resolves.

## Validation

`validate_config` reports no errors and one warning:

```text
- [UNVERIFIED_PORT] S1 (2960-24TT): port names FastEthernet0/2, FastEthernet0/3 and FastEthernet0/4 are unverified in Packet Tracer; if PT names a port differently, its addLink fails silently.
```

Only FastEthernet0/1 of the 2960-24TT's access ports has been confirmed so far. If a PC has no link after Run, that port name is the likely cause; please [report what Packet Tracer shows](https://github.com/aldoogando03-bit/mcp-tracer/issues/new?template=port_verification.yml).
