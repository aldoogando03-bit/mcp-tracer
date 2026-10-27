# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-27

Initial public release.

### Added

- MCP stdio server, run with `npx -y mcp-tracer`.
- Topology tools: `add_device`, `add_link`, `remove_device`, `remove_link`, `rename_device`, `configure_device`, `configure_pc`, `build_topology` (atomic: nothing changes if any item is invalid), `get_topology` and `reset_topology`.
- Script tools: `validate_config`, `generate_script` and `export_script`. Validation errors block generation unless `force: true` is passed.
- File tools: `save_topology` and `load_topology`, using a versioned JSON format (`mcp-tracer/topology`, version 1). Relative paths resolve against `MCP_TRACER_DIR` or the working directory, `~` is expanded, existing files are never replaced without `overwrite: true`, and loads are capped at 5 MB.
- Resources: `pt://catalog` and the `pt://catalog/{model}` template, with model-name completion.
- Prompts: `vlan_lab`, `ospf_lab`, `dhcp_lab` and `nat_lab`, each with computed addressing and a ready-made `build_topology` call.
- Validation with stable codes: 11 errors (such as `PORT_NOT_FOUND`, `CABLE_INCOMPATIBLE`, `IOS_ON_NON_IOS`) and 12 warnings (such as `UNVERIFIED_PORT`, `CABLE_SUSPICIOUS`, `GATEWAY_NOT_IN_SUBNET`), each with a suggested fix.
- Device catalog: exact PTBuilder model keys, aliases (`4331` → `ISR4331`, `WRT300N` → `Linksys-WRT300N`, `PC` → `PC-PT`), onboard ports with a per-port verification flag, and checks against the full list of PTBuilder model keys.
- Port name normalization (`Gi0/0` → `GigabitEthernet0/0`) and per-model port checks.
- Cable inference when a link has no cable (straight, cross, serial, console…).
- Automatic layout for devices without coordinates, in rows: routers, multilayer switches, switches, hosts.
- [docs/PTBUILDER_API.md](docs/PTBUILDER_API.md): PTBuilder API reference, with every unconfirmed item tagged "sin verificar".
- Examples in `examples/` (small office with DHCP, VLANs with router-on-a-stick, OSPF with three routers) and `npm run examples` to regenerate their scripts.
- `add_link` refuses a cable between two ports of the same device, and generated scripts configure hosts whose FastEthernet0 is verified (`PC-PT`, `Server-PT`) before the others, so a `configurePcIp` that fails on a `Laptop-PT` or `Printer-PT` can't skip them.

### Changed

- Renamed from the `packet-tracer-mcp` prototype to `mcp-tracer`. All tool descriptions and messages are now in English.

### Fixed

These fixes are relative to the unreleased `packet-tracer-mcp` prototype.

- The generated script no longer starts with a `//` comment. PTBuilder removes every line break before running a script, so the prototype's whole script became one comment and did nothing. The generator now never emits `//`, not even inside strings.
- IOS blocks are cleaned up: `enable`, `configure terminal`, `end`, `write memory` and `copy running-config startup-config` lines are dropped and reported (PTBuilder starts in global configuration mode and saves by itself), embedded line breaks are split and carriage returns removed.
- Model strings are checked against PTBuilder's table. Names such as `4331` or `WRT300N`, which made `addDevice` fail silently, now resolve to the right key.
- `configure_device` only accepts routers, switches and multilayer switches, and `configure_pc` only accepts hosts. Either mistake used to produce a call that aborts the script in Packet Tracer.
- DHCP hosts get `configurePcIp(name, true)` with no static address alongside, and static hosts must have both an IP address and a mask.
- Cables are inferred from the devices and ports instead of defaulting to `auto`, and the meaningless `wireless` cable was removed.
- Adding a device with an existing name is an error instead of silently replacing the first device.
- Devices without coordinates are laid out automatically instead of all being placed at (100, 100).
- U+2028 and U+2029 are escaped in emitted strings.

### Security

- File tools only accept their own extensions, case-insensitively: `.json` for `save_topology` and `load_topology`, `.js` or `.txt` for `export_script`. A tool call can never write a `.cmd`, `.bat` or other executable file. Paths that name a directory (`~`, `.`, `..`, a bare drive such as `C:`, an existing folder) or have `:` in the file name are refused.
- Device names are restricted to 1-64 characters (letters, digits, spaces and `. _ ( ) / -`, starting with a letter or digit), and `__proto__`, `constructor` and `prototype` are refused.
- Input size limits in the tool schemas, the topology file format and the model: 500 devices, 2000 links, 64-character model and port names, 32-character addresses, 2000 IOS commands of up to 512 characters per call and per device, 1024-character paths, and coordinates from -100000 to 100000.
- Port name normalization runs in linear time, device and port lookups use indexes, and the automatic layout always terminates, so oversized input can't stall the server.
- Lookups keyed by user input use `Map`s or own-key checks, so names such as `constructor` never resolve to `Object.prototype` members.

[Unreleased]: https://github.com/aldoogando03-bit/mcp-tracer/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/aldoogando03-bit/mcp-tracer/releases/tag/v0.1.0
