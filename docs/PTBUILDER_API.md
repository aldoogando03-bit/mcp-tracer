# PTBuilder API reference

This is the reference for the JavaScript API that **mcp-tracer** targets. The generated script runs inside the PTBuilder extension for Cisco Packet Tracer. Researched on 2026-10-27 (Phase 0).

> **The "sin verificar" tag.** "**sin verificar**" is Spanish for "unverified". It marks every statement this research could not confirm from a primary source: PTBuilder's own source code, wiki or maintainer comments, or Cisco's Packet Tracer documentation. Claims that rest only on third-party projects, on inference or on real-hardware naming conventions keep the tag. Remove it only after confirming the item in a real Packet Tracer run.
>
> **What an untagged claim means.** The primary source cited next to it supports it. **Nothing in this document was executed in Packet Tracer.** PT 9.0.1 is installed on the research machine, but no script was run there. Where a runtime behavior is *derived* from reading source code, the text says "inferred from source".

---

## Key rules for the generator (TL;DR)

1. **Never emit `//` comments.** The Builder Code Editor deletes every line break before it runs the code, so a `//` comment swallows the rest of the script. Use `/* … */` or no comment. ([§1](#1-how-a-script-is-executed))
2. **End every statement with `;`.** Without line breaks, automatic semicolon insertion cannot help. ([§1](#1-how-a-script-is-executed))
3. **`configureIosDevice` commands start in global configuration mode.** Do not send `enable` or `configure terminal`. Separate commands with `\n` inside the string. PTBuilder already runs `write memory` at the end. ([§2.3](#23-configureiosdevice))
4. **`configurePcIp` only works on hosts whose NIC is named `FastEthernet0`.** ([§2.4](#24-configurepcip))
5. **Model and cable strings must be exact keys of PTBuilder's tables.** For example, `ISR4331` works but `4331` does not, and `Linksys-WRT300N` works but `WRT300N` does not. ([§5](#5-device-models), [§3](#3-link-types))
6. **One uncaught exception aborts every later statement.** An unknown device name passed to `configureIosDevice` or `configurePcIp` throws. ([§1](#1-how-a-script-is-executed))

---

## 0. Sources and scope

- **PTBuilder is <https://github.com/kimmknight/PTBuilder>.** Its README describes the "Builder Code Editor" and the `addDevice`/`addLink` functions this project emits ([README][ptb-readme]). The research used `main` at commit [`1f56a82`][ptb-tree] (2026-05-19). The last code change is `095d691` (2026-03-29). The repository declares **no license**: the GitHub API returns `"license": null` and the tree has no LICENSE file ([repo API][ptb-repo-api]), so this project does not copy any PTBuilder code. This document describes PTBuilder's behavior in our own words and links to its source at the pinned commit; it does not reproduce PTBuilder code.
- **What was analysed:** `source/*.js` and the wiki ([wiki git history][ptb-wiki], HEAD `6167f31`, 2025-04-02). The distributable `Builder.pts` is encrypted and was **not decoded**. The commit history shows `Builder.pts` rebuilt in the same commits that change `source/`, most recently on 2026-03-29 ([Builder.pts history][ptb-pts-history]). The two are therefore presumed identical, but that is **sin verificar** for the binary itself.
- **Packet Tracer IPC API reference.** It is hosted at `tutorials.ptnetacad.net` ([LogicalWorkspace][pt-lw], [CiscoDevice][pt-cisco], [Device][pt-device], [Pc][pt-pc], [Server][pt-server], [HostPort][pt-hostport]), and the same pages ship with PT under `C:\Program Files\Cisco Packet Tracer 9.0.1\help\default\IpcAPI\`. The pages call themselves "Extensions API **8.1.0**", including the copy bundled with 9.0.1, and some enums in them are outdated (see [§5.2](#52-device-type-ids)).
- **Packet Tracer user help** (Cisco, primary): [Connections/Links][pt-links], [FAQ][pt-faq], [Devices and Modules][pt-modules], [Routers][pt-routers], [Switches][pt-switches], [End Devices][pt-end], [Other devices][pt-others], [PC configuration][pt-pcs], [My First PT Lab][pt-firstlab].
- **Secondary sources**, used only to corroborate: [Mats2208/MCP-Packet-Tracer][sec-mats] (commit `1a4eae5`), which claims live measurements on PT 9.0.1, and [muhammadbalawal/cisco-pt-mcp][sec-cpm], a PTBuilder fork. Claims that rest only on these are **sin verificar**. One of them contradicts primary evidence on the 3650-24PS ports (see [§6](#6-default-ports-of-common-models)).

---

## 1. How a script is executed

| Step | What happens | Source |
|---|---|---|
| Open the editor | Extensions > **Builder Code Editor**. The menu item is added by `builder.prototype.init`. | [main.js][ptb-main], [README][ptb-readme] |
| Install | Extensions > Scripting > Configure PT Script Modules > **Add…** > `Builder.pts`. One user on PT 9.0.0 also had to click **Run** in that dialog. | [README][ptb-readme], [issue #9][ptb-i9] |
| Click **Run** | `executeCode()` removes every newline character from the editor text, then hands the result to the script module's `runCode` function (through `$se`). **All line breaks are removed.** | [interface.js L13-L17][ptb-iface] |
| Execute | `runCode` turns the script text into a function body (with the `Function` constructor) and calls it. If the call throws, PT shows a message box ("An error occurred on line N") and returns `false`. | [runcode.js][ptb-runcode] |

Consequences, inferred from that source:

- **A `//` line comment disables everything after it.** The whole script is one line by the time it runs. Block comments `/* … */` survive.
- **Every statement needs an explicit `;`.** Without newlines, automatic semicolon insertion cannot apply. For example, `addDevice(...)` followed by `addDevice(...)` with no semicolon is a syntax error.
- **Multi-line template literals lose their line breaks.** Put `"\n"` escapes inside string literals instead, as the wiki examples do ([Functions][ptb-wiki-functions]). `JSON.stringify` already produces this form.
- **The script is a single function body.** The first uncaught exception stops every later statement.
- **Failures are mostly silent.** `addDevice`, `addLink` and `addModule` return `true`/`false`; their source paths contain no `throw` ([userfunctions.js][ptb-uf]). In contrast, `configureIosDevice` and `configurePcIp` look the device up by name in PT's network (`getDevice`) and call methods on the result without checking that a device was found ([L47-L68][ptb-uf-pcip-ios]). An unknown device name therefore throws a TypeError and aborts the run. The exact error text is **sin verificar**.
- **The engine supports at least ES2015 syntax.** PTBuilder itself uses `const`, `for…of` and default parameters ([runcode.js][ptb-runcode], [userfunctions.js][ptb-uf]). Whether U+2028/U+2029 are allowed inside string literals (an ES2019 change) is **sin verificar**.
- **User code shares the global scope of the script module.** It can call PT's IPC API directly. The maintainer shows how to turn on a server's DHCP service from the Builder this way: get the server from `ipc.network()` by name, then work with its `DhcpServerMain` process ([issue #2][ptb-i2]).

---

## 2. API signatures

These are all of PTBuilder's user functions ([userfunctions.js][ptb-uf], [wiki: Functions][ptb-wiki-functions]):

| Function | Exact signature (parameter names from source) | Returns | Source |
|---|---|---|---|
| `addDevice` | `addDevice(deviceName, deviceModel, x, y)` | `true` / `false` | [L1-L15][ptb-uf-adddevice] |
| `addLink` | `addLink(device1Name, device1Interface, device2Name, device2Interface, linkType)` | `true` / `false` | [L39-L45][ptb-uf-addlink] |
| `configureIosDevice` | `configureIosDevice(deviceName, commands)` | `undefined` | [L56-L68][ptb-uf-ios] |
| `configurePcIp` | `configurePcIp(deviceName, dhcpEnabled = undefined, ipaddress = undefined, subnetMask = undefined, defaultGateway = undefined, dnsServer = undefined)` | `undefined` | [L47-L54][ptb-uf-pcip] |
| `addModule` | `addModule(deviceName, slot, model)` | `true` / `false` | [L17-L37][ptb-uf-addmodule] |
| `getDevices` | `getDevices(filter = undefined, startsWith = "")` | `string[]` (device names) | [L112-L145][ptb-uf-getdevices] |

Global tables: `allDeviceTypes` ([devices.js][ptb-devices]), `allLinkTypes` ([links.js][ptb-links]), `allModuleTypes` ([modules.js][ptb-modules]) and `deviceTypes` ([userfunctions.js L70-L110][ptb-uf-types]). No other helpers exist. In [issue #4][ptb-i4] the maintainer mentioned arrays named `devices`, `ciscoDevices`, `routers`, `switches`, `layer2Switches` and `layer3Switches` as "not pushed yet". They are **not** in the source, so don't emit them.

### 2.1 `addDevice`

What the function does, step by step ([userfunctions.js L1-L15][ptb-uf-adddevice]):

1. It looks `deviceModel` up in PTBuilder's device table (`allDeviceTypes`, [§5](#5-device-models)) to get PT's numeric device type.
2. It calls PT's `LogicalWorkspace.addDevice` on the active workspace with that type, the model string and the coordinates ([LogicalWorkspace][pt-lw]). If PT returns no device name, `addDevice` returns `false`.
3. It renames the new device from PT's auto-generated name to `deviceName` (`setName`).
4. If the device is a router, a switch or a multilayer switch (types 0, 1 and 16), it calls `skipBoot`. It then returns `true`.

- **`deviceModel`** must be an exact, case-sensitive key of `allDeviceTypes` ([§5](#5-device-models)). If the model is unknown, `undefined` is passed to PT as the type. Whether that returns `false` or throws is **sin verificar**.
- **`x`, `y`** are logical-workspace coordinates. PT's docs describe them as "x coord to add the device at" and "y coord to add the device at" ([LogicalWorkspace.addDevice][pt-lw]).
- **Boot skipping.** Routers (type 0), switches (1) and multilayer switches (16) skip boot, so `configureIosDevice` can run right after `addDevice`.
- **Duplicate names.** PT's `addDevice` returns the auto-generated name, which PTBuilder then renames ([LogicalWorkspace][pt-lw]). A third party reports that PT accepts a rename to a name that is already taken, which leaves one device unreachable by name ([rough-edges][sec-mats-rough]). That report is **sin verificar**. Running the same script twice in one workspace will therefore duplicate devices (inference).

### 2.2 `addLink`

The function looks `linkType` up in PTBuilder's link-type table (`allLinkTypes`, [§3](#3-link-types)) and passes the resulting number, together with both device names and both interface names, to PT's `LogicalWorkspace.createLink` on the active workspace ([createLink][pt-lw]). It returns `true` when PT reports success and `false` otherwise ([userfunctions.js L39-L45][ptb-uf-addlink]).

- **`linkType`** is a key of `allLinkTypes` ([§3](#3-link-types)). Keys are plain object keys, so `"Straight"` does not match. If the key is unknown, `undefined` reaches PT, and the result (`false` or an exception) is **sin verificar**.
- **Port names.** PT documents `portName` as "one of the following plus a port number where appropriate: Console, Aux, Ethernet, FastEthernet, GigabitEthernet, Serial, Wireless, Loopback, Vlan, Modem, Coaxial, Rs232, Async. Example: FastEthernet0/0" ([LogicalWorkspace.createLink][pt-lw]). Use full names such as `GigabitEthernet0/0`. Whether abbreviations like `Gi0/0` work is **sin verificar**, since PT documents only the full prefixes.

### 2.3 `configureIosDevice`

What the function does, step by step ([userfunctions.js L56-L68][ptb-uf-ios]):

1. It gets the device by name from PT's network, without checking that one was found ([§1](#1-how-a-script-is-executed)).
2. If the device type is router, switch or multilayer switch (0, 1 or 16), it calls `skipBoot`, as `addDevice` does.
3. It enters a `!` line in `global` mode, which puts the CLI in global configuration mode.
4. It splits `commands` on `"\n"` and enters each line with an empty mode, that is, in whatever mode the CLI is currently in. The status each call returns is ignored.
5. It runs `write memory` in `enable` mode.

PT documents `CiscoDevice.enterCommand(commandStr, modeStr)` as follows: "Valid modes: user, enable, global. If blank, the command string will be entered into the current mode." It returns a status: `eStatusOk = 0, eErrorAmbiguous = 1, eErrorInvalid = 2, eErrorIncomplete = 3, eErrorNotImplemented = 4` ([CiscoDevice][pt-cisco]).

That gives these rules:

| Question | Answer | Basis |
|---|---|---|
| Does the block need `enable` / `configure terminal`? | **No.** PTBuilder first enters `!` in `"global"` mode, then every line in the current mode, so the block starts in global configuration mode. The wiki example starts directly with `hostname R1`, and so do the maintainer's examples (`"hostname R1\nenable secret class\n"`). | [L63-L65][ptb-uf-ios], [Functions][ptb-wiki-functions], [issue #4][ptb-i4] |
| Line separator? | `"\n"` (LF): the string is split on that character. In the script it must be the escape `\n` inside a string literal ([§1](#1-how-a-script-is-executed)). Whether a trailing `\r` breaks a command is **sin verificar**, so strip CRs. | [L62][ptb-uf-ios] |
| Sub-modes (`interface …`, `router ospf …`)? | They are entered as on a normal CLI ("current mode"), so leave them with `exit`. `end` drops to privileged EXEC, where later configuration lines would fail unless `configure terminal` follows. That is inferred from IOS semantics and is **sin verificar** in PT. | [CiscoDevice][pt-cisco] |
| Saving? | PTBuilder always finishes with `write memory` in `"enable"` mode, so the generator should not emit `write memory` or `end`. | [L67][ptb-uf-ios] |
| Error reporting? | None. The status `enterCommand` returns is ignored, so invalid commands fail silently. | [L65][ptb-uf-ios] |
| Visible in the CLI tab? | No. Since the March 2025 rewrite the commands go to a hidden line, which also bypasses enable/console passwords (maintainer). | [issue #4][ptb-i4] |
| Non-IOS devices (PC, Server)? | `enterCommand` is a `CiscoDevice` method ([CiscoDevice][pt-cisco]) and `Pc` does not list it ([Pc][pt-pc]). Calling `configureIosDevice` on a PC should throw and abort the script (inference, **sin verificar**). | — |
| Interactive prompts? | **sin verificar.** A user reports that `crypto key generate rsa general-keys modulus 1024` (no prompt) worked. | [issue #1][ptb-i1] |
| Known bug | Open report: on a `3650-24PS`, only the first SVI configured via PTBuilder comes up. That user's script also mixed `enable` and `conf t` into the block. | [issue #5][ptb-i5] |

### 2.4 `configurePcIp`

The function gets the device by name from PT's network, without checking that one was found, and then its port named `FastEthernet0` (`getPort`). It then applies only the settings whose arguments are truthy ([userfunctions.js L47-L54][ptb-uf-pcip]):

- if `dhcpEnabled` is truthy, it passes that value to the device's `setDhcpFlag`;
- if `ipaddress` and `subnetMask` are both truthy, it sets them on the port (`setIpSubnetMask`);
- if `defaultGateway` is truthy, it sets the port's default gateway (`setDefaultGateway`);
- if `dnsServer` is truthy, it sets the port's DNS server (`setDnsServerIp`).

Nothing else is configured, and nothing is returned. Consequences:

- **Arguments are positional:** `(deviceName, dhcpEnabled, ipaddress, subnetMask, defaultGateway, dnsServer)`. All but `deviceName` are optional, and the wiki adds that "if an ipAddress is specified, a subnetMask should also be specified". The wiki describes the function as configuring "the IP address settings on a PC or Server" ([Functions][ptb-wiki-functions]).
- **DNS is supported** through the 6th argument (`HostPort.setDnsServerIp`, [HostPort][pt-hostport]).
- **The port is hard-coded to `FastEthernet0`.** PC-PT and Server-PT have `FastEthernet0` ([My First PT Lab][pt-firstlab]). On any host without that port, for example one with a wireless module, the port lookup yields null and the first address setting applied to it throws. That aborts the script (inferred from source). Whether `Laptop-PT` and `Printer-PT` have it is **sin verificar** ([§6](#6-default-ports-of-common-models)).
- **`dhcpEnabled = false` is a no-op.** PTBuilder never calls `setDhcpFlag(false)`, so it cannot turn DHCP *off*. `true` calls `Pc.setDhcpFlag(true)` ([Pc][pt-pc]). `Server` inherits from `Pc` ([Server][pt-server]).
- **Empty strings are falsy and are skipped.** Passing `""` is the same as omitting the argument. If only one of `ipaddress`/`subnetMask` is given, the address is silently not set.
- **`dhcpEnabled = true` plus an IP:** both run, DHCP flag first and then the static address. The resulting state is **sin verificar**.
- **No IPv6.** There is an open request ([issue #7][ptb-i7]).

### 2.5 `addModule`

The function saves the power state and powers the device off. It then calls PT's `Device.addModule` with the slot, the module type that PTBuilder's module table (`allModuleTypes`) gives for `model`, and the `model` string itself, and finally restores power. Routers and switches then `skipBoot()`. It returns `true`/`false` ([L17-L37][ptb-uf-addmodule]). PT's signature is `Device.addModule(string slot, ModuleType type, string model)`, with module types `eLineCard = 0 … eNonRemovableModule = 18, eASAPowerAdapter = 19` ([Device][pt-device]). In the PT GUI, modules can also be changed only with the device powered off ([Devices and Modules][pt-modules]).

| Slot string | Device / module | Status | Source |
|---|---|---|---|
| `"0/0"` | `HWIC-1GE-SFP` on a router (wiki example) | from wiki | [Functions][ptb-wiki-functions] |
| `"0/0/0"` | `GLC-TE` into that HWIC (wiki example) | from wiki | [Functions][ptb-wiki-functions] |
| `"2/0"`, `"2/1"`, `"2/2"`, `"2/3"` | SFP slots of `3650-24PS` (`GLC-T`) | maintainer, tested in PT's debug console | [issue #1][ptb-i1] |
| `"0"` | `Linksys-WMP300N` on `PC-PT` | maintainer, 2026-03-29 | [issue #6][ptb-i6] |
| `"0/0"`…`"0/3"` (2911/2901 HWIC), `"0/0"`,`"0/1"` (1941), `"0/1"`,`"0/2"` (ISR4321/4331 NIM), `"1"` (2811 NM) | serial modules | **sin verificar** (third party, "verified PT 9.0.1") | [script-engine-api][sec-mats-api] |

Caveats:

- **Duplicate keys in `modules.js`.** JavaScript keeps the last value for a repeated key, so `"Linksys-WPC300N"` ends up as **15**, `"PT-CLOUD-NM-1CX"` as **10**, and `"PT-IOT-NM-1CE"`/`1CFE`/`1CGE`/`1W` as **23** ([modules.js L53, L78-L141][ptb-modules]). For example, `Linksys-WPC300N` on a laptop gets type 15 rather than the laptop module type 9. That probably fails (inference); compare [issue #6][ptb-i6].
- **`3650-24PS` power.** The maintainer could not add `AC-POWER-SUPPLY` to a 3650 in any slot. He suspects the 3650 needs type 18, while the table uses 4 ([issue #1][ptb-i1]). PT's enum has `eNonRemovableModule = 18` ([Device][pt-device]). See also [§6](#6-default-ports-of-common-models).
- **Older reports.** Adding a module to a powered-on router used to fail, now fixed by the power-off step ([issue #3][ptb-i3]). In that thread a user had to pass the Router-PT slot as the number `6`, not `"6/0"`.

### 2.6 `getDevices`

It returns the names of the devices in the workspace, optionally filtered by type name or ID through `deviceTypes` and by a name prefix ([L112-L145][ptb-uf-getdevices], [Functions][ptb-wiki-functions]). `deviceTypes` follows the older numbering, where `laptop` is 17 and `asa` is 26, but devices are created with the `devices.js` numbers, where Laptop-PT is 18 and 5505 is 27 ([§5.2](#52-device-type-ids)). Filtering by those types may therefore miss devices (inference, **sin verificar**). The generator does not need this function.

---

## 3. Link types

PTBuilder's link-type table (`allLinkTypes`, [links.js][ptb-links]) maps the keys below to PT's link-type enum ([createLink][pt-lw]); the wiki list matches ([Link Types][ptb-wiki-links]). The table lists every key and its value:

| PTBuilder key | Value | PT IPC enum ([createLink][pt-lw]) | PT GUI cable ([Connections/Links][pt-links]) | Connects | Status |
|---|---|---|---|---|---|
| `straight`, `ethernet-straight` | 8100 | `ETHERNET_STRAIGHT` | Copper Straight-through | 10/100/1000 copper Ethernet ports | mapping verified |
| `cross`, `ethernet-cross` | 8101 | `ETHERNET_CROSS` | Copper Cross-over | 10/100/1000 copper Ethernet ports | mapping verified |
| `roll` | 8102 | `ETHERNET_ROLL` | — (not in the help's cable list) | rollover | how it relates to `console` is **sin verificar** |
| `fiber` | 8103 | `FIBER` | Fiber Single-Mode and Multi-Mode | fiber ports | how `createLink` chooses SM or MM is **sin verificar** |
| `phone` | 8104 | `PHONE` | Phone | modem ports | mapping verified |
| `cable` | 8105 | `CABLE` | — | — | meaning **sin verificar** |
| `serial` | 8106 | `SERIAL` | Serial DCE and DTE | serial ports | which end becomes DCE through `createLink` is **sin verificar** |
| `auto` | 8107 | `AUTO` | — (GUI equivalent **sin verificar**) | — | **sin verificar** |
| `console` | 8108 | `CONSOLE` | Console | PC ↔ router/switch console | mapping verified |
| `wireless` | 8109 | `WIRELESS` | — (wireless links form by association, not by cable) | — | **sin verificar** through `createLink` |
| `coaxial` | 8110 | `COAXIAL` | Coaxial | coaxial ports | mapping verified |
| `octal` | 8111 | `OCTAL` | Octal | high-density async connector ↔ 8× RJ-45 | mapping verified |
| `cellular` | 8112 | `CELLULAR` | — | — | **sin verificar** |
| `usb` | 8113 | `USB` | USB | Things, MCU-PT, SBC-PT | mapping verified |
| `custom_io` | 8114 | `CUSTOM_IO` | IoE Custom Cable | Things, MCU-PT, SBC-PT | mapping verified |

"Mapping verified" means the key, the value and PT's enum name agree across [links.js][ptb-links] and [createLink][pt-lw]. Link behavior is not covered by that label.

---

## 4. Cable compatibility rules

From Cisco's Packet Tracer help ([Connections/Links][pt-links]) unless noted. "Each cable type can only be connected to certain interface types."

| Cable | Rule | Source |
|---|---|---|
| Copper straight-through | "connecting between devices that operate at different OSI layers (such as hub to router, switch to PC, and router to hub)". Port types: 10 Mbps Ethernet, 100 Mbps Fast Ethernet, 1000 Mbps Gigabit Ethernet (copper). | [pt-links] |
| Copper cross-over | "connecting between devices that operate at the same OSI layer (such as hub to hub, PC to PC, PC to printer)". Same port types. | [pt-links] |
| Fiber | Only between fiber ports (100 or 1000 Mbps). "GLC-LH-SMD and GLC-LX-SM-RGD modules are single mode modules and require single mode cables. The rest of fiber modules in PT are multimode." From PT 9.0.0, mismatched SM/MM links "are no longer allowed". | [pt-links], [FAQ #167][pt-faq] |
| Phone | "can only be made between devices with modem ports" (e.g. a PC dialing into a cloud). | [pt-links] |
| Coaxial | Between coaxial ports, "such as a cable modem connected to a Packet Tracer Cloud". | [pt-links] |
| Serial | "must be connected between serial ports". The DCE side needs clocking. With the GUI's "Serial DCE" cable, the first device is the DCE. In PT, "The DCE interface auto includes the clock rate command, defaulting to 2000000", and `clock rate` on a DTE prints "This command applies only to DCE interfaces". | [pt-links], [FAQ #120][pt-faq] |
| Console | "between PCs and routers or switches". The PC side is its "RS 232 port". | [pt-links], [PC config][pt-pcs] |
| Octal | "high-density connector on one end and eight RJ-45 plugs on the other" (async modules such as HWIC-8A, which "provides up to eight asynchronous EIA-232 connections to console ports"). | [pt-links], [Routers][pt-routers] |
| USB / IoE custom | For Things, components, MCU-PT and SBC-PT. | [pt-links] |
| Wireless | No cable: install a wireless module, power on, and the device associates with an access point. | [pt-links] |
| Access point | "Access points connect to hubs and switches with a straight-through cable. Meanwhile, a crossover cable is needed to connect an access point to routers and end devices." | [FAQ #27][pt-faq] |
| Same-switch loop | A copper cable between two ports of the same switch is refused ("The cable cannot be connected to that port"). | [FAQ #57][pt-faq] |
| Enforcement | PT's tutorial: a PC–Server link with straight-through shows red lights ("not working"), and with cross-over it comes up green. | [My First PT Lab][pt-firstlab] |

Practical Ethernet matrix:

| A ↔ B | Cable | Basis | Status |
|---|---|---|---|
| router ↔ switch | `straight` | help ("different OSI layers"); README example R1–S1 | verified |
| switch ↔ PC / server / printer | `straight` | help ("switch to PC"); README example S1–PC1 | verified |
| hub ↔ router / PC | `straight` | help | verified |
| PC ↔ PC, PC ↔ printer, PC ↔ server | `cross` | help; tutorial | verified |
| AP ↔ switch / hub | `straight` | FAQ #27 | verified |
| AP ↔ router / end device | `cross` | FAQ #27 | verified |
| switch ↔ switch | `cross` | classic rule; the [issue #1][ptb-i1] user script uses `cross` | whether PT rejects `straight` here (auto-MDIX) is **sin verificar** |
| router ↔ router (Ethernet) | `cross` | classic rule | **sin verificar** |
| router ↔ PC (Ethernet) | `cross` | classic rule (same layer, like PC–PC) | **sin verificar** |
| Serial ↔ Serial | `serial` | help | verified (DCE end via `createLink` **sin verificar**) |
| PC RS232 ↔ router/switch Console | `console` | help | verified (exact port-name strings **sin verificar**, see [§6](#6-default-ports-of-common-models)) |

---

## 5. Device models

### 5.1 Accepted model strings

`addDevice` looks the model up in PTBuilder's device table (`allDeviceTypes`, [devices.js][ptb-devices]). **Only that table's keys are accepted** ([userfunctions.js L2][ptb-uf-adddevice]), and the wiki list is the same ([Device Models][ptb-wiki-models]). These are all of its keys. The grouping is ours, based on the device type each key maps to:

- **Routers:** `1841`, `1941`, `2620XM`, `2621XM`, `2811`, `2901`, `2911`, `819HG-4G-IOX`, `819HGW`, `829`, `CGR1240`, `ISR4321`, `ISR4331`, `Router-PT`, `Router-PT-Empty`
- **Switches:** `2950-24`, `2950T-24`, `2960-24TT`, `Switch-PT`, `Switch-PT-Empty`
- **Multilayer switches:** `3560-24PS`, `3650-24PS`, `IE-2000`
- **End devices:** `PC-PT`, `Server-PT`, `Laptop-PT`, `Printer-PT`, `TabletPC-PT`, `SMARTPHONE-PT`, `WirelessEndDevice-PT`, `WiredEndDevice-PT`, `TV-PT`, `7960` (IP phone), `Home-VoIP-PT`, `Analog-Phone-PT`
- **Wireless:** `AccessPoint-PT`, `AccessPoint-PT-A`, `AccessPoint-PT-AC`, `AccessPoint-PT-N`, `Linksys-WRT300N`, `HomeRouter-PT-AC`, `DLC100`, `WLC-2504`, `WLC-3504`, `WLC-PT`, `3702i`, `LAP-PT`, `Meraki-MX65W`
- **Security:** `5505`, `5506-X`
- **WAN emulation and other devices:** `Cloud-PT`, `Cloud-PT-Empty`, `DSL-Modem-PT`, `Cable-Modem-PT`, `Cell-Tower`, `Central-Office-Server`, `Hub-PT`, `Bridge-PT`, `Repeater-PT`, `CoAxialSplitter-PT`, `Sniffer`, `802`, `803`, `Meraki-Server`, `NetworkController`, `Copper Patch Panel`, `Fiber Patch Panel`, `Copper Wall Mount`, `Fiber Wall Mount`, `Power Distribution Device`
- **IoT:** `MCU-PT`, `SBC-PT`, `Embedded-Server-PT`, plus 78 IoT "Thing" models such as `Thing`, `Air Conditioner`, `Door`, `Smoke Detector`, `Webcam` and `Window`. Many of these keys contain spaces. The full list is in [devices.js][ptb-devices] and on the wiki ([Device Models][ptb-wiki-models]).

Some keys, such as `1941` or `7960`, are written as bare numbers in PTBuilder's table. JavaScript turns them into string keys, so pass them as strings (`"1941"`), as the README does with `"2911"` ([README][ptb-readme]).

**Requested names, checked against the table:**

| Name you might use | Valid PTBuilder key | Note |
|---|---|---|
| 2911, 1941, 2901, 2811, 1841 | `"2911"`, `"1941"`, `"2901"`, `"2811"`, `"1841"` | valid |
| 4321 / 4331 | `"ISR4321"` / `"ISR4331"` | **`"4321"` and `"4331"` are not keys** |
| 2960-24TT, 3560-24PS, 3650-24PS | same | valid; see the 3650 power caveat in [§6](#6-default-ports-of-common-models) |
| PC-PT, Server-PT, Laptop-PT, Printer-PT, Cloud-PT, AccessPoint-PT, Router-PT, Switch-PT, Hub-PT | same | valid |
| WRT300N | `"Linksys-WRT300N"` | **`"WRT300N"` is not a key** |
| ASA5505 / ASA 5506-X | `"5505"` / `"5506-X"` | **`"ASA5505"` is not a key** |
| IP Phone 7960 | `"7960"` | **`"IP Phone 7960"` is not a key** |
| 2960 (bare), 3560 (bare) | — | not keys |
| IE-3400, IE-9320, IR1101, IR8340, PT8200 | — | Packet Tracer 9 documents these devices ([Switches][pt-switches], [Routers][pt-routers], [PT8200](https://tutorials.ptnetacad.net/help/default/config_PT8200.htm)), but they are **not** in `allDeviceTypes`, so `addDevice` cannot create them |

### 5.2 Device type IDs

PTBuilder passes the number from `devices.js` to PT's `addDevice(type, model, x, y)`. From ID 17 up, those numbers **disagree** with the enum in PT's IPC docs (labelled 8.1.0):

| Model | `devices.js` | PT docs enum ([LogicalWorkspace.addDevice][pt-lw]) |
|---|---|---|
| Laptop-PT | 18 | `eLaptop = 17` (18 = `eTabletPC`) |
| 5505, 5506-X | 27 | `eASA = 26` (27 = `eIoE`) |
| Thing (IoT) | 39 | `eThing = 36` |
| WLC-2504/3504/PT | 41 | `eWirelessLanController = 39` |
| 3702i, LAP-PT | 44 | `eCiscoAccessPoint = 31` |
| Routers / switches / MLS / PC / Server / Printer | 0 / 1 / 16 / 8 / 9 / 10 | same in both |

The repo is inconsistent with itself as well. `getDevices` uses the docs' numbering ([L70-L110][ptb-uf-types], [Device Types][ptb-wiki-types]), and the wiki compatibility list, built from `devices.js`, labels Laptop-PT "Tablet PC" and 5505 "IoE" ([compat list][ptb-wiki-compat]). A third party that measured PT 9.0.1 found the `devices.js` values correct (3560/3650/IE-2000 = 16, Laptop-PT = 18, ASAs = 27, Thing = 39, WLC-2504 = 41, LAP-PT = 44), and reports that a wrong type makes `addDevice` create nothing ([test_device_type_ids.py][sec-mats-typeids]). That is **sin verificar** by us. **Impact on this project:** none, as long as the generator passes model strings to PTBuilder's `addDevice` and lets PTBuilder do the lookup.

---

## 6. Default ports of common models

"Count verified" means a Cisco PT help page states the number and kind of onboard ports but not their exact names.

| Model key | Type | Onboard ports | Evidence | Status | Modules / notes |
|---|---|---|---|---|---|
| `"2911"` | 0 | `GigabitEthernet0/0`, `GigabitEthernet0/1`, `GigabitEthernet0/2` | Gi0/0 and Gi0/1 in the maintainer's examples ([Functions][ptb-wiki-functions], [README][ptb-readme]); PT: "3 integrated 10/100/1000 Ethernet ports, 4 enhanced high-speed WAN interface card (WIC) slots" ([Routers][pt-routers]) | Gi0/0–0/1 verified; Gi0/2 count verified, name **sin verificar** | No onboard serial. Serial needs e.g. HWIC-2T in a WIC slot ([Routers][pt-routers]); slot IDs **sin verificar** ([§2.5](#25-addmodule)) |
| `"1941"` | 0 | `GigabitEthernet0/0`, `GigabitEthernet0/1` | PT: "2 integrated 10/100/1000 Ethernet ports, 2 WAN Interface Card (WIC) slots" ([Routers][pt-routers]); Gi0/1 in a user script ([issue #1][ptb-i1]) | count verified; names **sin verificar** | Serial needs HWIC-2T/WIC-2T/WIC-1T |
| `"2901"` | 0 | `GigabitEthernet0/0`, `GigabitEthernet0/1` | PT: "2 integrated 10/100/1000 Ethernet ports, 4 enhanced high-speed WAN interface card (WIC) slots" ([Routers][pt-routers]) | count verified; names **sin verificar** | as 1941 |
| `"ISR4321"` | 0 | `GigabitEthernet0/0/0`, `GigabitEthernet0/0/1` | no primary source; third-party catalog ([devices.py][sec-mats-catalog]) | **sin verificar** | Serial needs NIM-2T ("a 2 port multi-protocol Synchronous Serial NIM", [Routers][pt-routers]) |
| `"ISR4331"` | 0 | `GigabitEthernet0/0/0`–`0/0/2` | third-party only | **sin verificar** | NIM-2T |
| `"1841"` | 0 | `FastEthernet0/0`, `FastEthernet0/1` | PT: "two fixed 10/100 (100BASE-TX) Ethernet ports, two integrated High-Speed WAN Interface Card (HWIC) slots" ([Routers][pt-routers]) | count verified; names **sin verificar** | Serial via WIC/HWIC |
| `"2811"` | 0 | `FastEthernet0/0`, `FastEthernet0/1` | PT: "one Enhanced Network-Module slot with two fixed 10/100 (100BASE-TX) Ethernet ports, four integrated High-Speed WAN Interface Card (HWIC) slots" ([Routers][pt-routers]) | count verified; names **sin verificar** | Serial via HWIC or NM |
| `"Router-PT"` | 0 | **sin verificar** | PT: "ten slots, one console port, and one auxiliary port" ([Routers][pt-routers]) | **sin verificar**; third-party sources conflict (Fa0/0–0/1 in [devices.py][sec-mats-catalog] vs "odd port names (e.g. `Serial2/0`)" in [script-engine-api][sec-mats-api]) | avoid in generated topologies until verified |
| `"2960-24TT"` | 1 | `FastEthernet0/1`–`0/24`, `GigabitEthernet0/1`–`0/2` | README uses `FastEthernet0/1` and `GigabitEthernet0/1` ([README][ptb-readme]); the user script in [issue #1][ptb-i1] uses Fa0/1–0/3; PT: Fast Ethernet + Gigabit Ethernet, "does not support add-in modules" ([Switches][pt-switches]) | Fa0/1 and Gi0/1 verified; full ranges **sin verificar** | Vlan1 is an SVI, not a cabling port |
| `"2950-24"` | 1 | `FastEthernet0/1`–`0/24` | PT: "managed 10/100 switch", no add-in modules ([Switches][pt-switches]) | **sin verificar** | — |
| `"2950T-24"` | 1 | `FastEthernet0/1`–`0/24`, `GigabitEthernet0/1`–`0/2` | PT: Fast Ethernet + Gigabit Ethernet, no add-in modules ([Switches][pt-switches]) | **sin verificar** | — |
| `"3560-24PS"` | 16 | `FastEthernet0/1`–`0/24`, `GigabitEthernet0/1`–`0/2` | PT: Fast Ethernet + Gigabit Ethernet, "does not support add-in modules" ([Switches][pt-switches]) | **sin verificar** | Probably the safer L3 switch choice (see the 3650 row) |
| `"3650-24PS"` | 16 | `GigabitEthernet1/0/1`–`1/0/24`; SFP uplinks once GLC modules go in slots `2/0`–`2/3` | Gi1/0/1–1/0/3 in a user script, with slots 2/0–2/3 confirmed by the maintainer ([issue #1][ptb-i1]); PT module list: AC-POWER-SUPPLY, POWER-COVER-PLATE, GLC-LH-SMD, GLC-T ([Switches][pt-switches]) | `1/0/x` naming partly verified; range and uplink port names **sin verificar** | **"The 3650 devices do not come installed with power supplies, and therefore no power until you install one"** ([FAQ #159][pt-faq]). PTBuilder's `addModule` could not add `AC-POWER-SUPPLY` ([issue #1][ptb-i1]), so a 3650 built by PTBuilder may stay unpowered (**sin verificar** on the current release). The third-party catalog lists Fa0/x ports for this model, which contradicts the evidence here |
| `"PC-PT"` | 8 | `FastEthernet0`; console port "RS 232" | README `addLink(…,"PC1","FastEthernet0",…)` ([README][ptb-readme]); `configurePcIp` uses `FastEthernet0` ([L49][ptb-uf-pcip]); PT tutorial ([My First PT Lab][pt-firstlab]); "provides a console port and one slot" ([End Devices][pt-end]); "RS 232 port" ([PC config][pt-pcs]) | `FastEthernet0` verified; the RS232 port-name string for `addLink` (`Rs232`? `RS232`?) is **sin verificar** | — |
| `"Server-PT"` | 9 | `FastEthernet0` | PT tutorial: "Open the Server configuration window … Click FastEthernet0" ([My First PT Lab][pt-firstlab]); wiki: `configurePcIp` is for "a PC or Server" ([Functions][ptb-wiki-functions]) | verified | "provides two slots" ([End Devices][pt-end]) |
| `"Laptop-PT"` | 18 | `FastEthernet0` | PT: "provides a console port and one slot" ([End Devices][pt-end]); name only in the third-party catalog | **sin verificar** | If a wireless module replaces the NIC, `configurePcIp` breaks ([§2.4](#24-configurepcip)) |
| `"Printer-PT"` | 10 | `FastEthernet0` | PT: "provides one slot" ([End Devices][pt-end]); name only in the third-party catalog | **sin verificar** | — |
| `"Cloud-PT"` | 2 | `Ethernet6` plus modem ports; full list per third party: `Serial0`–`3`, `Modem4`–`5`, `Ethernet6`, `Coaxial7` | FAQ #102 names "a cloud's Ethernet6 port" and its modem port ([FAQ][pt-faq]) | `Ethernet6` verified; the rest **sin verificar** ([devices.py][sec-mats-catalog] says it read them via `getPorts()` on PT 9.0.1) | — |
| `"AccessPoint-PT"` | 7 | `Port 0` | PT: "has a built-in antenna and provides one slot" ([Other devices][pt-others]) | **sin verificar** | — |
| `"Linksys-WRT300N"` | 11 | `Internet`, `Ethernet 1`–`Ethernet 4` | PT: "four fixed 10/100 (100BASE-TX) Ethernet ports and one fixed Internet port" ([Other devices][pt-others]) | count verified; names **sin verificar** | — |
| `"5505"` | 27 | **sin verificar** (real ASA 5505 hardware uses `Ethernet0/0`–`0/7`, from general knowledge; no source fetched) | none | **sin verificar**; the third-party catalog says `FastEthernet0/0`–`0/7` (conflict) | ASA CLI differs from IOS |
| `"5506-X"` | 27 | **sin verificar** (real hardware: `GigabitEthernet1/1`–`1/8`, from general knowledge; no source fetched) | none | **sin verificar**; third party says `1/0`–`1/7` (conflict) | — |
| `"7960"` | 12 | **sin verificar** | PT: "The 7960 IP Phone only provides a port for the power adapter" ([End Devices][pt-end]). Module `IP_PHONE_POWER_ADAPTER` has type 11 = `eIpPhonePowerAdapter` ([modules.js][ptb-modules], [Device][pt-device]) | **sin verificar** | Powering it over PoE instead is **sin verificar** |

Router and switch console ports: PT's port-name prefixes include `Console` and `Aux` ([createLink][pt-lw]). The exact strings (`Console` vs `Console0`) are **sin verificar**.

---

## 7. Discrepancies with the current generator

> **Historical.** This section records the Phase 0 review of the original prototype (root-level `index.ts`, `topology.ts`, `ptbuilder.ts`); the file and line references point at that prototype, not at `src/`. Version 0.1.0 addresses D1–D9 and D11 (see `CHANGELOG.md`), except `addModule` support from D8 (serial ports on routers only produce a `SERIAL_NEEDS_MODULE` warning); D10 (checking `addDevice`/`addLink` return values in the script) and D12 (re-running in a non-empty workspace) remain open and are documented as limitations in the README.

The comparison covers `ptbuilder.ts`, the `cable` enum and tool descriptions in `index.ts`, and `topology.ts`.

**What already matches.** All four emitted function names exist: `addDevice`, `addLink`, `configureIosDevice`, `configurePcIp`. Their argument order matches PTBuilder's signatures exactly ([§2](#2-api-signatures)). `configurePcIp` does take a 6th `dns` argument. All 10 strings in the `cable` enum (`index.ts:21`) are valid `allLinkTypes` keys. The emission order (devices → links → IOS → PC IPs) suits PTBuilder: devices exist before anything references them, and routers and switches skip boot in `addDevice`. Every string goes through `JSON.stringify`, which turns command separators into `\n` escapes, the form PTBuilder needs. The models named in the `add_device` description (`2911, 2960-24TT, PC-PT, Server-PT, Laptop-PT`) are all valid keys.

| # | Severity | Where | Discrepancy | Fix |
|---|---|---|---|---|
| D1 | **Blocker** | `ptbuilder.ts:7` | The script starts with `// Generado por packet-tracer-mcp`. The editor removes every `\n` before running ([interface.js L15][ptb-iface]), so the whole script becomes one comment. **Nothing runs and no error is shown** (inferred from source). | Drop the line or use `/* packet-tracer-mcp */`. Never emit `//`. Add a unit test that the output has no `//` outside string literals. |
| D2 | High | `ptbuilder.ts:10`, `index.ts:27` | The model string goes out unchecked. Common names like `4331`, `WRT300N`, `ASA5505` and `IP Phone 7960` are not keys ([§5.1](#51-accepted-model-strings)). `addDevice` then fails silently, and any later `configureIosDevice`/`configurePcIp` for that name throws and aborts the rest of the script. | Validate models against the `allDeviceTypes` keys, and offer aliases (`4331`→`ISR4331`, …) or reject with the valid list. |
| D3 | High | `index.ts:40`, `ptbuilder.ts:16` | The `configure_device` contract is undefined. PTBuilder starts in **global config mode** and saves automatically ([§2.3](#23-configureiosdevice)). Agents will likely send `enable`, `configure terminal`, `end` and `write memory`. The first two only produce silent errors, but an `end` in the middle drops out of config mode, so the commands after it fail silently. | Say so in the tool description, and strip or reject a leading `enable`/`conf t`, `end` and `write memory`/`wr`. Strip `\r`. |
| D4 | High | `topology.ts:30-33`, `ptbuilder.ts:16` | `configureIosDevice` is emitted for any device type. On a PC or Server, `device.enterCommand` does not exist (`Pc` class), so the call should throw and abort (inference). | Allow IOS config only for router, switch and multilayer-switch models (types 0, 1, 16). |
| D5 | High | `ptbuilder.ts:20`, `index.ts:47` | `configurePcIp` writes only to `FastEthernet0` ([§2.4](#24-configurepcip)). The tool advertises Laptop support (Laptop-PT `FastEthernet0` is **sin verificar**). Any host without that port throws and aborts. | Allow it only for models with a verified `FastEthernet0` (PC-PT, Server-PT) and warn for the others. |
| D6 | Medium | `ptbuilder.ts:20`, `topology.ts:35-38` | With `dhcp: true` the generator still emits the IP, mask and gateway, and PTBuilder applies both (effect **sin verificar**). With `dhcp: false` PTBuilder does nothing about DHCP, which is fine for new hosts but cannot switch an existing host back to static. Empty strings are harmless because PTBuilder skips falsy values. | When DHCP is on, emit `configurePcIp(name, true);` only. When it is off, require `ip` and `mask` together. |
| D7 | Medium | `index.ts:20-22` | The cable enum defaults to `"auto"`, and `AUTO` (8107) behavior through `createLink` is **sin verificar**. `"wireless"` is probably meaningless as a cable ([§3](#3-link-types)), and the difference between `"roll"` and `"console"` is unclear. | Infer the cable from the device pair and port types ([§4](#4-cable-compatibility-rules)) instead of defaulting to `auto`, and drop `wireless`/`roll` until verified. If needed, add `octal`, `usb`, `custom_io`, `cellular` and `cable` (valid keys that are not exposed). |
| D8 | Medium | `ptbuilder.ts:13`, `topology.ts:43-48` | Port names are not normalized or checked per model. PT documents only full prefixes (`GigabitEthernet`, `FastEthernet`, …) ([createLink][pt-lw]), and abbreviations are **sin verificar**. `serial` links on 1941/2901/2911/ISR43xx need a module first, and the generator cannot add modules. | Expand abbreviations (`Gi`→`GigabitEthernet`, `Fa`→`FastEthernet`, `Se`→`Serial`). Validate against [§6](#6-default-ports-of-common-models) for the verified models. Add `addModule` support (with slot strings once verified, [§2.5](#25-addmodule)), and reject serial links on devices without serial modules. |
| D9 | Medium | models | `3650-24PS` ships without a power supply ([FAQ #159][pt-faq]), and PTBuilder could not add one ([issue #1][ptb-i1]). | Prefer `3560-24PS` for L3 switches, or warn whenever a 3650 is used. |
| D10 | Low | `ptbuilder.ts` (all) | Nothing checks return values, so failed `addDevice`/`addLink` calls are invisible. | Optional: emit checks such as `if (!addLink(...)) f.push("R1-S1");` and, at the end, `if (f.length) throw new Error("Failed: " + f.join(", "));`. PTBuilder's error box then lists the failures. This idea is **sin verificar**. |
| D11 | Low | `ptbuilder.ts:3` | `JSON.stringify` leaves U+2028/U+2029 unescaped, and support in PT's engine is **sin verificar**. | Replace them with `\u2028` / `\u2029` in `q()`. |
| D12 | Low | docs | Re-running a script in a non-empty workspace may duplicate devices or names ([§2.1](#21-adddevice)). | Tell users in the README to run the script in a new, empty workspace (File > New). |

---

## 8. Still to verify in a real Packet Tracer run

Every **sin verificar** item above. The ones that matter most:

- [ ] D1: a `//` comment really disables the whole script (`Builder.pts` matches `source/`).
- [ ] What `addDevice` and `addLink` do with an unknown model or link type: return `false`, or throw?
- [ ] Whether `addLink` accepts abbreviated port names (`Gi0/0`).
- [ ] `auto`, `roll` vs `console`, `wireless`, `cable`, `cellular` through `createLink`, and which end of a `serial` link becomes DCE.
- [ ] Whether `straight` between two switches, two routers, or a router and a PC comes up (auto-MDIX).
- [ ] Full port lists of 2911/1941/2901/ISR4321/ISR4331/1841/2811/2960-24TT/3560-24PS/3650-24PS/Laptop-PT/Printer-PT/Router-PT/WRT300N/ASA. Use `d.getPorts()` from the Builder or PT's script-module Debug console ([issue #1][ptb-i1] describes how).
- [ ] The console port strings for PC (`RS232`?) and routers (`Console`?).
- [ ] Module slot strings per router family, and the resulting serial port names.
- [ ] Whether a `3650-24PS` created by PTBuilder is powered.
- [ ] `configurePcIp` with `dhcp=true` plus a static IP; `configurePcIp` on Laptop-PT and Printer-PT.
- [ ] `configureIosDevice` behavior with `end`, interactive prompts, and CRLF input.

---

**Module names.** The `model` argument of `addModule` must be a key of PTBuilder's module table (`allModuleTypes`, [modules.js][ptb-modules]); the wiki lists them too ([Module Models](https://github.com/kimmknight/PTBuilder/wiki/Module-Models)). The module keys this document refers to are `HWIC-2T`, `WIC-2T`, `WIC-1T`, `NIM-2T`, `HWIC-1GE-SFP`, `HWIC-8A`, `GLC-T`, `GLC-TE`, `GLC-LH-SMD`, `AC-POWER-SUPPLY`, `POWER-COVER-PLATE`, `Linksys-WMP300N`, `Linksys-WPC300N`, `IP_PHONE_POWER_ADAPTER`, `PT-CLOUD-NM-1CX` and `PT-IOT-NM-1CE`/`1CFE`/`1CGE`/`1W`. `GLC-LX-SM-RGD`, quoted in [§4](#4-cable-compatibility-rules) from PT's FAQ, is not a key. Some keys appear more than once in the table, and the last value wins ([§2.5](#25-addmodule)).

---

## References

PTBuilder (primary; pinned to commit `1f56a82380a21fde157b73fee6a81928c5784cdb`):

- `ptb-tree` — <https://github.com/kimmknight/PTBuilder/tree/1f56a82380a21fde157b73fee6a81928c5784cdb>
- `ptb-readme` — <https://github.com/kimmknight/PTBuilder/blob/1f56a82380a21fde157b73fee6a81928c5784cdb/README.md>
- `ptb-uf` — <https://github.com/kimmknight/PTBuilder/blob/1f56a82380a21fde157b73fee6a81928c5784cdb/source/userfunctions.js>
- `ptb-links` — <https://github.com/kimmknight/PTBuilder/blob/1f56a82380a21fde157b73fee6a81928c5784cdb/source/links.js>
- `ptb-devices` — <https://github.com/kimmknight/PTBuilder/blob/1f56a82380a21fde157b73fee6a81928c5784cdb/source/devices.js>
- `ptb-modules` — <https://github.com/kimmknight/PTBuilder/blob/1f56a82380a21fde157b73fee6a81928c5784cdb/source/modules.js>
- `ptb-iface` — <https://github.com/kimmknight/PTBuilder/blob/1f56a82380a21fde157b73fee6a81928c5784cdb/source/interface/interface.js#L13-L17>
- `ptb-runcode` — <https://github.com/kimmknight/PTBuilder/blob/1f56a82380a21fde157b73fee6a81928c5784cdb/source/runcode.js>
- `ptb-main` — <https://github.com/kimmknight/PTBuilder/blob/1f56a82380a21fde157b73fee6a81928c5784cdb/source/main.js>
- `ptb-pts-history` — <https://github.com/kimmknight/PTBuilder/commits/main/Builder.pts>
- `ptb-repo-api` — <https://api.github.com/repos/kimmknight/PTBuilder>
- `ptb-wiki` — <https://github.com/kimmknight/PTBuilder/wiki>
- Wiki pages: [Functions][ptb-wiki-functions], [Link Types][ptb-wiki-links], [Device Models][ptb-wiki-models], [Device Types][ptb-wiki-types], [Module Models](https://github.com/kimmknight/PTBuilder/wiki/Module-Models), [Device Module Compatibility List][ptb-wiki-compat]
- Issues: [#1][ptb-i1], [#2][ptb-i2], [#3][ptb-i3], [#4][ptb-i4], [#5][ptb-i5], [#6][ptb-i6], [#7][ptb-i7], [#9][ptb-i9]

Cisco Packet Tracer documentation (primary; the same files ship in `C:\Program Files\Cisco Packet Tracer 9.0.1\help\default\`):

- IPC API: [LogicalWorkspace][pt-lw], [CiscoDevice][pt-cisco], [Device][pt-device], [Pc][pt-pc], [Server][pt-server], [HostPort][pt-hostport]
- Help: [Connections/Links][pt-links], [FAQ][pt-faq], [Devices and Modules][pt-modules], [Routers][pt-routers], [Switches][pt-switches], [End Devices][pt-end], [Other devices][pt-others], [PC config][pt-pcs], [My First PT Lab][pt-firstlab]

Secondary (corroboration only):

- `sec-mats` — <https://github.com/Mats2208/MCP-Packet-Tracer/tree/1a4eae5e2f0bec97e85d4518b9f8cdf831468d6b>
- `sec-cpm` — <https://github.com/muhammadbalawal/cisco-pt-mcp>

[ptb-tree]: https://github.com/kimmknight/PTBuilder/tree/1f56a82380a21fde157b73fee6a81928c5784cdb
[ptb-readme]: https://github.com/kimmknight/PTBuilder/blob/1f56a82380a21fde157b73fee6a81928c5784cdb/README.md
[ptb-uf]: https://github.com/kimmknight/PTBuilder/blob/1f56a82380a21fde157b73fee6a81928c5784cdb/source/userfunctions.js
[ptb-uf-adddevice]: https://github.com/kimmknight/PTBuilder/blob/1f56a82380a21fde157b73fee6a81928c5784cdb/source/userfunctions.js#L1-L15
[ptb-uf-addmodule]: https://github.com/kimmknight/PTBuilder/blob/1f56a82380a21fde157b73fee6a81928c5784cdb/source/userfunctions.js#L17-L37
[ptb-uf-addlink]: https://github.com/kimmknight/PTBuilder/blob/1f56a82380a21fde157b73fee6a81928c5784cdb/source/userfunctions.js#L39-L45
[ptb-uf-pcip]: https://github.com/kimmknight/PTBuilder/blob/1f56a82380a21fde157b73fee6a81928c5784cdb/source/userfunctions.js#L47-L54
[ptb-uf-ios]: https://github.com/kimmknight/PTBuilder/blob/1f56a82380a21fde157b73fee6a81928c5784cdb/source/userfunctions.js#L56-L68
[ptb-uf-pcip-ios]: https://github.com/kimmknight/PTBuilder/blob/1f56a82380a21fde157b73fee6a81928c5784cdb/source/userfunctions.js#L47-L68
[ptb-uf-types]: https://github.com/kimmknight/PTBuilder/blob/1f56a82380a21fde157b73fee6a81928c5784cdb/source/userfunctions.js#L70-L110
[ptb-uf-getdevices]: https://github.com/kimmknight/PTBuilder/blob/1f56a82380a21fde157b73fee6a81928c5784cdb/source/userfunctions.js#L112-L145
[ptb-links]: https://github.com/kimmknight/PTBuilder/blob/1f56a82380a21fde157b73fee6a81928c5784cdb/source/links.js
[ptb-devices]: https://github.com/kimmknight/PTBuilder/blob/1f56a82380a21fde157b73fee6a81928c5784cdb/source/devices.js
[ptb-modules]: https://github.com/kimmknight/PTBuilder/blob/1f56a82380a21fde157b73fee6a81928c5784cdb/source/modules.js
[ptb-iface]: https://github.com/kimmknight/PTBuilder/blob/1f56a82380a21fde157b73fee6a81928c5784cdb/source/interface/interface.js#L13-L17
[ptb-runcode]: https://github.com/kimmknight/PTBuilder/blob/1f56a82380a21fde157b73fee6a81928c5784cdb/source/runcode.js
[ptb-main]: https://github.com/kimmknight/PTBuilder/blob/1f56a82380a21fde157b73fee6a81928c5784cdb/source/main.js
[ptb-pts-history]: https://github.com/kimmknight/PTBuilder/commits/main/Builder.pts
[ptb-repo-api]: https://api.github.com/repos/kimmknight/PTBuilder
[ptb-wiki]: https://github.com/kimmknight/PTBuilder/wiki
[ptb-wiki-functions]: https://github.com/kimmknight/PTBuilder/wiki/Functions
[ptb-wiki-links]: https://github.com/kimmknight/PTBuilder/wiki/Link-Types
[ptb-wiki-models]: https://github.com/kimmknight/PTBuilder/wiki/Device-Models
[ptb-wiki-types]: https://github.com/kimmknight/PTBuilder/wiki/Device-Types
[ptb-wiki-compat]: https://github.com/kimmknight/PTBuilder/wiki/Device-Module-Compatibility-List
[ptb-i1]: https://github.com/kimmknight/PTBuilder/issues/1
[ptb-i2]: https://github.com/kimmknight/PTBuilder/issues/2
[ptb-i3]: https://github.com/kimmknight/PTBuilder/issues/3
[ptb-i4]: https://github.com/kimmknight/PTBuilder/issues/4
[ptb-i5]: https://github.com/kimmknight/PTBuilder/issues/5
[ptb-i6]: https://github.com/kimmknight/PTBuilder/issues/6
[ptb-i7]: https://github.com/kimmknight/PTBuilder/issues/7
[ptb-i9]: https://github.com/kimmknight/PTBuilder/issues/9
[pt-lw]: https://tutorials.ptnetacad.net/help/default/IpcAPI/class_logical_workspace.html
[pt-cisco]: https://tutorials.ptnetacad.net/help/default/IpcAPI/class_cisco_device.html
[pt-device]: https://tutorials.ptnetacad.net/help/default/IpcAPI/class_device.html
[pt-pc]: https://tutorials.ptnetacad.net/help/default/IpcAPI/class_pc.html
[pt-server]: https://tutorials.ptnetacad.net/help/default/IpcAPI/class_server.html
[pt-hostport]: https://tutorials.ptnetacad.net/help/default/IpcAPI/class_host_port.html
[pt-links]: https://tutorials.ptnetacad.net/help/default/connectionsLinks.htm
[pt-faq]: https://tutorials.ptnetacad.net/help/default/faqTroubleShoot.htm
[pt-modules]: https://tutorials.ptnetacad.net/help/default/devicesAndModules.htm
[pt-routers]: https://tutorials.ptnetacad.net/help/default/devicesAndModules_routers.htm
[pt-switches]: https://tutorials.ptnetacad.net/help/default/devicesAndModules_switches.htm
[pt-end]: https://tutorials.ptnetacad.net/help/default/devicesAndModules_endDevices.htm
[pt-others]: https://tutorials.ptnetacad.net/help/default/devicesAndModules_others.htm
[pt-pcs]: https://tutorials.ptnetacad.net/help/default/config_PCs.htm
[pt-firstlab]: https://tutorials.ptnetacad.net/help/default/myFirstPTLab.htm
[sec-mats]: https://github.com/Mats2208/MCP-Packet-Tracer/tree/1a4eae5e2f0bec97e85d4518b9f8cdf831468d6b
[sec-mats-catalog]: https://github.com/Mats2208/MCP-Packet-Tracer/blob/1a4eae5e2f0bec97e85d4518b9f8cdf831468d6b/src/packet_tracer_mcp/infrastructure/catalog/devices.py
[sec-mats-typeids]: https://github.com/Mats2208/MCP-Packet-Tracer/blob/1a4eae5e2f0bec97e85d4518b9f8cdf831468d6b/tests/test_device_type_ids.py
[sec-mats-api]: https://github.com/Mats2208/MCP-Packet-Tracer/blob/1a4eae5e2f0bec97e85d4518b9f8cdf831468d6b/skill/reference/script-engine-api.md
[sec-mats-rough]: https://github.com/Mats2208/MCP-Packet-Tracer/blob/1a4eae5e2f0bec97e85d4518b9f8cdf831468d6b/skill/reference/rough-edges.md
[sec-cpm]: https://github.com/muhammadbalawal/cisco-pt-mcp
