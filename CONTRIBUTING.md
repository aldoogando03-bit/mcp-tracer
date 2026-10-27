# Contributing to mcp-tracer

Thanks for helping. Bug reports, verified port names, docs fixes and code are all welcome. Code, comments, docs and every message the server returns are in English. Issues can be written in English or Spanish.

## Development setup

You need Node.js 20 or later.

```bash
git clone https://github.com/aldoogando03-bit/mcp-tracer.git
cd mcp-tracer
npm ci
npm run build
npm test
```

Use `npm ci`, which installs exactly what `package-lock.json` pins. If you need to regenerate the lockfile (to add or upgrade a dependency), use **npm 11 or later**, for example `npx npm@11 install`. npm 10's resolver crashes on vite's optional peer dependencies. For the same reason vite is pinned to 7.x in `devDependencies`; don't bump it without checking that `npm ci` still works on Node 20.

| Script | What it does |
|---|---|
| `npm run build` | Compile `src/` to `build/` (cleans first). |
| `npm run dev` | Run the server from source with `tsx`. |
| `npm start` | Run `build/index.js`. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm test` / `npm run test:watch` | Vitest, once or in watch mode. |
| `npm run examples` | Build, then regenerate `examples/*/script.js`. Fails if an example has validation errors. |

To exercise the tools by hand, run the MCP Inspector: `npx @modelcontextprotocol/inspector node build/index.js`.

[CLAUDE.md](CLAUDE.md) has the architecture (one row per source file), the data flow and the conventions. Read it before your first change.

## Hard rules

1. **stdout belongs to the MCP protocol.** The server talks to its client over stdio, so never call `console.log` or `process.stdout.write` in `src/`. Log through `src/log.ts`, which writes to stderr.
2. **The generated script never contains `//`.** PTBuilder's Builder Code Editor removes every line break before running the script, so a `//` comment disables everything after it. End every statement with `;`. Every string emitted into the script goes through `q()` in `src/ptbuilder.ts`, which also escapes `//` inside strings. Keep the emission order: devices, links, IOS configs, host IPs.
3. **Check docs/PTBUILDER_API.md first.** It is the source of truth for PTBuilder's function signatures, model keys, port names and cable types. Read it before changing `ptbuilder.ts`, `catalog.ts`, `cables.ts`, or any tool description or doc that names models or ports. New facts need a primary source: PTBuilder's source, wiki or maintainer comments, Cisco's Packet Tracer documentation, or a real Packet Tracer run.
4. **Keep "sin verificar" honest.** Anything not confirmed by a primary source is tagged **"sin verificar"** (Spanish for "unverified") in the doc and has `verified: false` in the catalog. Leave it that way until someone verifies it, and don't present it as fact in tool descriptions, docs or examples.
5. **Validation codes are stable.** A new check gets a new `UPPER_SNAKE` code. Never rename or reuse an existing code: agents and scripts rely on them.
6. **IOS blocks start in global configuration mode.** PTBuilder's `configureIosDevice` enters global config itself and runs `write memory` at the end, so the generator never emits `enable`, `configure terminal`, `end` or `write memory`.
7. **Fail with actionable errors.** Domain failures `throw new Error(...)` with a message that tells the agent what to do; tool handlers wrap them with `safe()` / `safeAsync()` so they come back as `isError` results. Tool descriptions are written for an LLM: name exact model keys and full port names.

## Adding a model to the catalog

1. Check that the model string is an exact key of PTBuilder's `allDeviceTypes` table (docs/PTBUILDER_API.md §5.1, mirrored in `PTBUILDER_MODELS` in `src/catalog.ts`). PTBuilder cannot create anything else.
2. Add an entry to `CATALOG` in `src/catalog.ts`:
   - `model`: the exact key. `aliases`: other names users type.
   - `category`, and `layer` for cable inference: 3 for router- or host-like devices, 2 for switch-like ones, 1 for hubs.
   - `ios: true` only for PTBuilder device types 0, 1 and 16 (routers, switches, multilayer switches). `pcIp: true` only for hosts whose NIC is `FastEthernet0`.
   - `ports`, each with `verified: true` only when a primary source confirms the exact name.
   - `portsVerified`: `verified` or `partial` when the port count is confirmed (unlisted ports are then rejected), `unverified` when the names come from third parties or convention (unlisted ports are accepted with a warning), `unknown` when there is no port data.
   - `notes` for anything an agent should know.
3. Document the ports and their evidence in docs/PTBUILDER_API.md §6, tagging what is unverified.
4. Add tests: model and alias resolution, port checks and, for a new kind of device, cable inference.
5. The `add_device` and `add_link` descriptions and the `pt://catalog` resource are generated from `CATALOG`, so they update on their own. Read the new descriptions once to make sure they still make sense.

## Reporting a verified port name

This is one of the most useful contributions. Most port names in the catalog have never been confirmed in a real Packet Tracer run, and each report removes a "sin verificar". Open a [port verification report](https://github.com/aldoogando03-bit/mcp-tracer/issues/new?template=port_verification.yml) with:

- your Packet Tracer version (Help > About), the PTBuilder version or commit you installed, and your OS;
- the model key (for example `2960-24TT`) and the exact port names, spelled as Packet Tracer shows them;
- the evidence: a screenshot (the device's Physical or Config tab, or the port menu that opens when you connect a cable), or the output of `getPorts()` for the device (docs/PTBUILDER_API.md §8 and [PTBuilder issue #1](https://github.com/kimmknight/PTBuilder/issues/1) describe how to run it). If you ran a generated script, say whether each `addLink` created its link.

The other open questions in docs/PTBUILDER_API.md §8 (how `auto` and `straight` cables behave between switches, console port names, whether a 3650-24PS gets power) are welcome in the same form.

To turn a report into a pull request: set `verified: true` on the port in `src/catalog.ts`, update §6 of the doc, remove the "sin verificar" tag for that item only, and link the evidence.

## Commits and pull requests

- Keep each pull request to one change, branched from `main`.
- `npm run typecheck` and `npm test` must pass. Add or update tests for any change in behaviour.
- If your change alters the generated scripts (generator, layout, catalog, cable inference), run `npm run examples` and commit the regenerated `examples/*/script.js`. `node scripts/build-examples.mjs --check` tells you whether they are stale.
- Add a line to `CHANGELOG.md` under `[Unreleased]`.
- When user-facing behaviour changes, update `README.md` and `README.es.md` together. If you can't write the Spanish part, say so in the pull request.
- Write commit messages with a short imperative summary line and, when it helps, a body that explains why.

## Code of conduct

Be respectful and constructive. Harassment, insults and personal attacks are not tolerated in issues, pull requests or any other project space.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
