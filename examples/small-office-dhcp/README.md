# Small office with DHCP

One router, one switch and three PCs on 192.168.1.0/24. The router is the gateway and hands out the addresses by DHCP. This is the example walked through in the [main README](../../README.md#complete-example).

| Device | Model | Connected to | Address |
|---|---|---|---|
| R1 | `2911` | GigabitEthernet0/0 to S1 GigabitEthernet0/1 | 192.168.1.1/24, DHCP server |
| S1 | `2960-24TT` | | |
| PC1 | `PC-PT` | FastEthernet0 to S1 FastEthernet0/1 | DHCP |
| PC2 | `PC-PT` | FastEthernet0 to S1 FastEthernet0/2 | DHCP |
| PC3 | `PC-PT` | FastEthernet0 to S1 FastEthernet0/3 | DHCP |

R1's DHCP pool `OFFICE` serves 192.168.1.0/24 with default router 192.168.1.1. Addresses 192.168.1.1 to 192.168.1.10 are excluded, so leases start at 192.168.1.11. All cables are straight-through, inferred by the server.

## Files

- `topology.json`: the topology in the `save_topology` file format.
- `script.js`: the PTBuilder script, generated from `topology.json` by `npm run examples`.

The examples live in the GitHub repository, not in the npm package. Clone the repository or download this folder.

## Use it

**With your agent.** Ask it to load the file, for example: "Load /path/to/mcp-tracer/examples/small-office-dhcp/topology.json and generate the script." The agent calls `load_topology`:

```json
{ "path": "/path/to/mcp-tracer/examples/small-office-dhcp/topology.json" }
```

Use an absolute path, or a path relative to `MCP_TRACER_DIR`. Once it's loaded you can ask for changes, such as another PC, before `generate_script`.

**Without an agent.** Open `script.js` and copy all of it.

**In Packet Tracer:** File > New, then Extensions > Builder Code Editor. Paste the script, click **Run**, and wait until every link light is green (switch ports take about 30 seconds).

## Check that it works

- **PC1 > Desktop > IP Configuration** shows DHCP with an address from 192.168.1.11 up and gateway 192.168.1.1. If it shows 169.254.x.x, click **DHCP** again once the links are green.
- **PC1 > Desktop > Command Prompt**: `ipconfig`, `ping 192.168.1.1`, then ping PC2's address.
- **R1 > CLI**: `show ip interface brief` (GigabitEthernet0/0 up/up) and `show ip dhcp binding` (one lease per PC).

## Validation

`validate_config` reports no errors and one warning:

```text
- [UNVERIFIED_PORT] S1 (2960-24TT): port names FastEthernet0/2 and FastEthernet0/3 are unverified in Packet Tracer; if PT names a port differently, its addLink fails silently.
```

Only FastEthernet0/1 of the 2960-24TT's access ports has been confirmed so far. If PC2 or PC3 has no link after Run, that port name is the likely cause; please [report what Packet Tracer shows](https://github.com/aldoogando03-bit/mcp-tracer/issues/new?template=port_verification.yml).
