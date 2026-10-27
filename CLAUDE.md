# CLAUDE.md

Guidance for AI agents and contributors working on **mcp-tracer** (MIT, published to GitHub and npm).

## What this is

An MCP stdio server that lets an AI agent design Cisco Packet Tracer topologies. It never talks to Packet Tracer directly. It keeps an in-memory model and emits a JavaScript script for the [PTBuilder](https://github.com/kimmknight/PTBuilder) extension.

Data flow:

1. An MCP client calls a tool. The SDK validates the input against its zod schema.
2. The handler mutates `session.topology`. Mutators enforce invariants (unique names, known models, free ports, IOS only on IOS devices…) and throw `Error` on violation.
3. `generate_script` / `export_script` call `renderScript()`: `validate()` first (errors block unless `force: true`), then `generatePTBuilderScript()`.
4. The user pastes the script into a **new, empty** Packet Tracer workspace under **Extensions > Builder Code Editor** and clicks **Run**.

## Architecture

| File | Role |
|---|---|
| `src/index.ts` | npm `bin` entry. Keep `#!/usr/bin/env node` on line 1. Connects `createServer()` to stdio. |
| `src/server.ts` | `createServer()`: builds the `McpServer` and a `Session`, registers tools, resources and prompts. Exported for in-memory tests. |
| `src/session.ts` | `Session { topology; replaceTopology(t) }`. One per server process; state is lost on restart. |
| `src/topology.ts` | The model: devices, links, IOS configs, host IPs. Mutators, `toJSON()` / `fromJSON()`, `fromSpec()` (atomic `build_topology`). |
| `src/catalog.ts` | Models (exact PTBuilder keys, aliases, category, ports with `verified` flags), `PTBUILDER_MODELS`, `resolveModel`, `normalizePort`. |
| `src/ipv4.ts` | IPv4 parse/format, mask ↔ prefix helpers shared by `topology.ts`, `validate.ts` and `prompts.ts`. |
| `src/cables.ts` | Cable types, port-kind/cable compatibility, `inferCable` (used when a link has no cable). |
| `src/validate.ts` | `validate(t) → { errors, warnings }` with stable `UPPER_SNAKE` issue codes; `formatValidation`. |
| `src/layout.ts` | `layoutPositions(t)`: keeps explicit x/y, places the rest in rows (routers → L3 switches → switches → hosts). |
| `src/ptbuilder.ts` | `generatePTBuilderScript(t)`: pure string generation. |
| `src/render.ts` | `renderScript(t, { force })`: validation-gated rendering shared by `generate_script` and `export_script`. |
| `src/persistence.ts` | Topology file format, path resolution (`MCP_TRACER_DIR`, else cwd), size-capped reads, no-overwrite writes. |
| `src/tools/topology.ts`, `src/tools/files.ts` | Tool registration. `tools/util.ts` holds `safe()` / `text()` / `fail()`. |
| `src/resources.ts` | `pt://catalog` and the `pt://catalog/{model}` template. |
| `src/prompts.ts` | `vlan_lab`, `ospf_lab`, `dhcp_lab`, `nat_lab`: each embeds a computed `build_topology` spec. |
| `src/version.ts`, `src/log.ts` | Version read from `package.json`; stderr-only logger. |

Only `src/index.ts`, `src/server.ts`, `src/tools/*`, `src/resources.ts` and `src/prompts.ts` may import the MCP SDK. Everything else is pure and unit-testable.

## Conventions

- **stdout is reserved for the MCP stdio protocol.** Never use `console.log` or `process.stdout.write`. Log through `src/log.ts` (stderr).
- ESM with `module`/`moduleResolution: Node16`: relative imports need the `.js` suffix in `.ts` files.
- `strict` TypeScript, ES2022, zod 4 (`z.number()` already rejects Infinity/NaN).
- Tools use `server.registerTool` with `title`, `description`, `inputSchema` and annotations. Descriptions are written for an LLM: name exact model keys and full port names.
- Domain failures are `throw new Error(...)` with an actionable message; handlers wrap them with `safe()` (or `safeAsync` in `files.ts`) so they return `isError` results.
- All user-facing text is English.
- Every string emitted into the generated script goes through `q()` (JSON.stringify + U+2028/U+2029 escaping).
- Emission order: devices → links → IOS configs → host IPs.
- New validation checks get a new stable code; never reuse or rename a code.
- Input limits live in `LIMITS` (`src/topology.ts`) and apply in three places that must agree: the tool zod schemas, `topologyJsonSchema` and the mutators (so anything the mutators accept can be saved and loaded back). Device names follow `DEVICE_NAME` (1-64 chars: letters, digits, space, `. _ ( ) / -`, alphanumeric first; `constructor`/`prototype` reserved). File tools only accept `.json` (save/load) or `.js`/`.txt` (export). Key lookups on user input with a `Map` or `Object.hasOwn`, never a plain object.

## Commands

```bash
npm ci             # use npm >= 11 if you must regenerate package-lock.json (npm 10 crashes on vite's peers)
npm run build      # clean + tsc -> build/
npm run typecheck  # tsc --noEmit on src, then on the tests (test/tsconfig.json)
npm start          # node build/index.js (stdio server, waits for a client)
npm run dev        # tsx src/index.ts, no build step
npm test           # vitest run
npm run examples   # rebuild, then regenerate examples/*/script.js (fails on validation errors)
```

Manual end-to-end check: `npx @modelcontextprotocol/inspector node build/index.js`.

## PTBuilder API

Hard rules for the generator (verified in PTBuilder's source, see `docs/PTBUILDER_API.md` §1–§2):

- The Builder Code Editor strips every `\n` before running, so the script runs as one line. **Never emit `//` comments** (they disable the rest of the script) and **end every statement with `;`**.
- `configureIosDevice` starts in global config mode and runs `write memory` itself: don't emit `enable`, `configure terminal`, `end` or `write memory` (the model strips them).
- `configurePcIp` only touches `FastEthernet0`, and `configureIosDevice` only works on IOS devices. An unknown device name in either one throws and aborts the rest of the script.
- Model and cable strings must be exact keys of PTBuilder's tables (`ISR4331`, not `4331`).

`docs/PTBUILDER_API.md` is the source of truth for PTBuilder function signatures, device model names, port names and link/cable types. Check it before changing `ptbuilder.ts`, `catalog.ts`, `cables.ts`, or any description or doc that names models or ports. Items not confirmed against PTBuilder's source or a real Packet Tracer run are tagged **"sin verificar"** in the doc and `verified: false` in the catalog. Keep them that way until verified, and don't present them as fact.

## Known limitations

- Nothing has been run in a real Packet Tracer yet; see the checklist in `docs/PTBUILDER_API.md` §8. Many port names (ISR4321/4331, 3560/3650, Laptop/Printer, console ports) are unverified.
- No `addModule` support, so routers have no serial ports; labs must use Ethernet between routers.
- `3650-24PS` ships without a power supply in PT and PTBuilder can't add one; prefer `3560-24PS`.
- Generated scripts don't check `addDevice`/`addLink` return values, so a failed call in PT is silent.
