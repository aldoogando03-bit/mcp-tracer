---
name: mcp-tracer
description: Design Cisco Packet Tracer network topologies with the mcp-tracer MCP server and turn them into a PTBuilder script. Use when the user wants to build, plan or lay out a Packet Tracer lab (routers, switches, PCs, VLANs, OSPF, DHCP, NAT) or asks for a script they can paste into Packet Tracer's Builder Code Editor. Needs the mcp-tracer MCP server connected.
---

# Designing Packet Tracer labs with mcp-tracer

mcp-tracer is an MCP server that keeps a network topology in memory and turns it into a JavaScript script for the PTBuilder extension. **It never talks to Packet Tracer.** You build and validate the topology with its tools, hand the user a script, and the user pastes it into Packet Tracer and runs it.

## Before you start

1. Check that the mcp-tracer tools (`add_device`, `build_topology`, `validate_config`, `generate_script`…) are available. If they are not, tell the user to add the server and restart the client. Do not invent a script by hand:

   ```bash
   claude mcp add mcp-tracer -- npx -y mcp-tracer
   ```

   Other clients use the same command (`npx -y mcp-tracer`) in their MCP configuration. Node.js 20 or later is required.
2. The user also needs Cisco Packet Tracer 8 or 9 and the PTBuilder extension (`Builder.pts` from https://github.com/kimmknight/PTBuilder, added under **Extensions > Scripting > Configure PT Script Modules**). Mention this if they have never run a PTBuilder script.

## Workflow

1. **Clarify only what you need**: devices, how they connect, IP plan, which services (DHCP, NAT, VLANs, routing). If the request is a standard lab, use the defaults below instead of asking.
2. **Start from a prompt when one fits.** The server has four lab prompts that already compute the addressing and the exact `build_topology` call: `vlan_lab`, `ospf_lab`, `dhcp_lab` and `nat_lab`. In Claude Code they appear as `/mcp__mcp-tracer__vlan_lab` and so on. Adapt their result instead of redoing the addressing.
3. **Build in one atomic call with `build_topology`** (`devices`, `links`, `ios`, `pcs`). If any item is invalid nothing changes and the error names the item, so you can fix it and retry. Use `add_device`, `add_link`, `configure_device` and `configure_pc` for small edits afterwards.
4. **Always run `validate_config`** and fix every error. Read the warnings and tell the user about the relevant ones.
5. **Call `generate_script`** and give the user the whole script in a code block. Do not edit or shorten it.
6. **Tell the user how to run it**:
   - File > New, so the workspace is empty. Running a script twice, or in a workspace that already has the devices, duplicates them.
   - Extensions > Builder Code Editor, paste the whole script, click Run.
   - Wait for every link light to turn green. Switch ports can take about 30 seconds.
7. **Offer checks** to confirm it worked, such as `ipconfig` and `ping` on a PC, or `show ip interface brief` on a router.

Optional: `save_topology` writes the topology to a `.json` file (and `load_topology` reads it back), and `export_script` writes the script to a `.js` file. The topology lives in the server's memory and is lost when the client restarts the server.

## Rules that avoid most errors

- **Use exact model keys**: `2911`, `ISR4331`, `2960-24TT`, `3560-24PS`, `PC-PT`, `Server-PT`. Aliases such as `4331` or `PC` resolve automatically, but unknown names are rejected. `pt://catalog` lists every model with its ports.
- **Use full or abbreviated port names**: `GigabitEthernet0/0` or `Gi0/0`, `FastEthernet0/1` or `Fa0/1`. A port takes only one link.
- **Safest models**: `2911`, `2960-24TT`, `PC-PT` and `Server-PT`, because their most-used port names are verified. Prefer them unless the user asks for something else.
- **Prefer `3560-24PS` over `3650-24PS`.** The 3650 ships without a power supply in Packet Tracer and may stay off.
- **IOS commands** (`configure_device`) run in global configuration mode on routers, switches and multilayer switches only. Do not send `enable`, `configure terminal`, `end` or `write memory`; they are dropped and reported.
- **Host addressing** (`configure_pc`) only configures FastEthernet0, as static (`ip` and `mask`) or DHCP. Use it on `PC-PT` and `Server-PT`.
- **Device names**: 1 to 64 characters, unique, case-insensitive; letters, digits, spaces and `. _ ( ) / -`, starting with a letter or digit.
- **Leave `cable` out** and the server picks one: `straight` between unlike devices, `cross` between like devices. Set it only when the user asks.
- **Do not pass `force: true`** to `generate_script` just to get past an error. Fix the error.

## What it cannot do

Be upfront about these when they matter to the request:

- It cannot see or change a network that is already running in Packet Tracer, and it cannot read `show` output.
- No modules: routers have no serial ports, so use Ethernet between routers.
- Server services, such as the DHCP service of a `Server-PT`, must be configured by hand in Packet Tracer. Host addressing is IPv4 only.
- Nothing has been verified in a real Packet Tracer run yet. Many port names (most 2960 ports, the ISR4321/4331 ports, the 3560/3650 ports, console ports) follow Cisco's naming but are unconfirmed. `validate_config` flags them as `UNVERIFIED_PORT`; mention this if a lab depends on them.
- A device or link that Packet Tracer refuses is silently missing, and invalid IOS commands fail silently. If something is missing after Run, check the Builder Code Editor and the device CLI.

## Links

- Repository and full tool reference: https://github.com/aldoogando03-bit/mcp-tracer
- Website: https://mcp-tracer-web.vercel.app
- npm: https://www.npmjs.com/package/mcp-tracer
