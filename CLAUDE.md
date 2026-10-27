# CLAUDE.md

Guidance for AI agents and contributors working on **packet-tracer-mcp** (MIT, published to GitHub and npm).

## What this is

An MCP stdio server that lets an AI agent design Cisco Packet Tracer topologies. It never talks to Packet Tracer directly. It keeps an in-memory model and emits a JavaScript script for the PTBuilder extension.

Data flow:

1. An MCP client calls a tool (`add_device`, `add_link`, `configure_device`, `configure_pc`, `build_topology`, `get_topology`, `validate_config`, `generate_script` or `reset_topology`).
2. The SDK validates the input against the tool's zod schema, and the handler mutates the single `Topology` instance.
3. `generate_script` calls `generatePTBuilderScript(topo)`, which returns PTBuilder calls (`addDevice`, `addLink`, `configureIosDevice`, `configurePcIp`).
4. The user pastes the script into Packet Tracer under **Extensions > Builder Code Editor** and clicks **Run**.

## Architecture

This is the target layout. Today the three `.ts` files are at the repo root, pending the Phase 1 move to `src/`; until then the build is broken (see Known issues).

| File | Role |
|---|---|
| `src/index.ts` | Entry point and npm `bin`. Creates `McpServer`, registers all tools, connects `StdioServerTransport`. Keep `#!/usr/bin/env node` on line 1. |
| `src/topology.ts` | The `Topology` model: `devices` (a Map keyed by name), `links` (an array), `configs` (IOS commands per device), `pcIps`. Mutators throw `Error`; `validate()` returns issue strings; `toJSON()` backs `get_topology`. |
| `src/ptbuilder.ts` | The pure function `generatePTBuilderScript(t)`. Emits devices, then links, then IOS configs, then PC IPs. Does no I/O. |
| `docs/PTBUILDER_API.md` | The PTBuilder reference (see below). |
| `build/` | `tsc` output, gitignored. `package.json` `bin` points to `build/index.js`. |

Keep `topology.ts` and `ptbuilder.ts` free of SDK/MCP imports so they can be unit-tested in isolation.

## Conventions

- **stdout is reserved for the MCP stdio protocol.** Never use `console.log` or `process.stdout.write`, because any stray byte corrupts JSON-RPC. Log only to stderr (`console.error`).
- The package is ESM (`"type": "module"`) with `module`/`moduleResolution` set to `Node16`. Relative imports need the `.js` suffix, even in `.ts` files (`import { Topology } from "./topology.js"`).
- TypeScript runs with `strict: true` and targets ES2022. `index.ts` uses top-level `await`.
- Every tool input is a zod raw shape. Define shared schemas such as `cable` once and reuse them. Use `.default()` for optional values with defaults.
- Every handler goes through `safe(() => string)`. It returns a text result, or `isError: true` with `Error: <message>` if the callback throws. Domain failures are `throw new Error(...)` inside `Topology`; never return an error message as a success. zod validation failures already come back from the SDK as `isError` results (`MCP error -32602`).
- State is in memory: one `Topology` per server process, lost on restart. `reset_topology` and `build_topology` wipe it.
- Every string emitted into the generated script goes through `q()` (`JSON.stringify`); never interpolate raw strings into generated JS. Numbers and booleans are interpolated as-is, so they must be validated as finite first.
- Emission order matters: a device must be emitted before any link or config that references it.
- Language: all user-facing strings (tool descriptions, results, errors, README, the `package.json` description) are being moved from Spanish to **English** in Phase 1. New code and strings should be in English.

## Commands

```bash
npm install
npm run build   # tsc -> build/   (currently fails: TS18003, see Known issues)
npm start       # node build/index.js; a stdio server that waits for a client
npm run dev     # tsx src/index.ts; runs without a build step
npm test        # planned: vitest (not configured yet)
```

For a manual end-to-end check, run `npx @modelcontextprotocol/inspector node build/index.js`.

## PTBuilder API

Hard rules for the generator (verified in PTBuilder's source, see `docs/PTBUILDER_API.md` §1–§2):

- The Builder Code Editor strips every `\n` before running, so the script runs as one line. **Never emit `//` comments** (they disable the rest of the script) and **end every statement with `;`**.
- `configureIosDevice` starts in global config mode and runs `write memory` itself: don't emit `enable`, `configure terminal`, `end` or `write memory`.
- `configurePcIp` only touches `FastEthernet0`, and `configureIosDevice` only works on IOS devices. An unknown device name in either one throws and aborts the rest of the script.
- Model and cable strings must be exact keys of PTBuilder's tables (`ISR4331`, not `4331`).

`docs/PTBUILDER_API.md` is the source of truth for PTBuilder function signatures, device model names, port names and link/cable types. Check it before changing `ptbuilder.ts`, the `cable` enum in `index.ts`, or any tool description or README text that names models or ports. Items that have not been confirmed against PTBuilder's source or a real Packet Tracer run are tagged **"sin verificar"**. Keep the tag until the item is verified, and don't present unverified names as fact in tool descriptions or docs.

## Known issues (as of Phase 0)

Build and packaging:
- `tsconfig.json:7` (`rootDir: "src"`), `tsconfig.json:12` (`include: ["src"]`) and `package.json:10` (`dev: tsx src/index.ts`) all point at `src/`, but the sources are at the root. `npm run build` fails with TS18003 "No inputs were found". With equivalent compiler flags, the root files type-check cleanly.
- `package.json` has no `files` field, and `.gitignore:2` ignores `build`. npm only packs `build/` because the `bin` entry (`package.json:6`) happens to pull it in; without `bin`, `build/` is dropped. Raw `.ts` files ship too. Add `"files"` plus a `prepublishOnly`/`prepare` build.
- No `LICENSE` file exists, although `package.json:21` declares MIT. No `engines`, `repository`, `keywords` or `test` script either.
- The version is hard-coded twice: `index.ts:9` and `package.json:3`.
- `npm audit` reports a high-severity advisory against `zod@3.25.76` (GHSA-mrhx-c7xc-m3w5). Its fix is zod 4, which is breaking; the SDK accepts `^3.25 || ^4.0`.
- `server.tool(...)` (`index.ts:24-97`) is deprecated in `@modelcontextprotocol/sdk@1.32.2`. Migrate to `registerTool`, which also allows `title` and annotations such as `destructiveHint` for `reset_topology` and `build_topology`.

Model and validation:
- `topology.ts:19-21`: `addDevice` silently overwrites a device with the same name, even with a different model. Its links, IOS config and PC IP stay attached to the replaced device.
- There is no way to remove a device or link (`topology.ts` has no remove methods). Fixing a single mistake requires a full `reset_topology`.
- `topology.ts:23-28`: `addLink` accepts self-loops (`R1:Gi0/0 <-> R1:Gi0/0`), exact duplicate links, and ports already in use. Port names are never checked against the device model.
- `topology.ts:30-33` vs `35-38`: IOS commands are append-only (they can't be cleared without a reset), while `configurePc` replaces. Neither checks the device type, so IOS commands on `PC-PT` and IP config on a router are both accepted.
- `topology.ts:35-38`: a static PC config with no `ip` or `mask` is accepted and emits empty strings. IPv4 and mask formats aren't validated. With `dhcp: true`, any `ip` is still emitted.
- `topology.ts:43-48`: duplicate-port detection compares exact strings, so `Gi0/0` and `GigabitEthernet0/0` are treated as different ports, and the check is case-sensitive.
- `index.ts:27,63`: names and models accept `""` (no `.min(1)`). `z.number()` accepts `Infinity` (JSON `1e999`), which `ptbuilder.ts:10` emits as the bare token `Infinity`. `x`/`y` default to 100 in `add_device`, so devices added without coordinates stack on one point; `build_topology` requires `x`/`y`.
- `index.ts:70-75`: `build_topology` is not atomic. It runs `reset()` first, so a bad link or IOS entry leaves a partial topology. It also can't set PC IPs, because it has no `pcs` array.

Generator:
- `ptbuilder.ts:10,13,16,20`: the function names, argument order and IOS command format are unverified against PTBuilder, and so is the `cable` enum (`index.ts:21`). Reconcile all of them with `docs/PTBUILDER_API.md`.
- `ptbuilder.ts:3`: `JSON.stringify` leaves U+2028/U+2029 unescaped, and these are syntax errors in pre-ES2019 JS engines. Packet Tracer's script engine version is "sin verificar".
- `ptbuilder.ts:7`: an empty topology produces only the header comment, with no warning.

Language:
- User-facing strings are in Spanish: `index.ts:26-98`, `topology.ts:25,31,36,46,52`, `ptbuilder.ts:5,7`, `README.md`, and `package.json:4`.
