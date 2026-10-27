/**
 * Regenerates examples/<name>/script.js from examples/<name>/topology.json with the compiled server code in build/.
 *
 *   npm run examples                       build, then regenerate every script.js
 *   node scripts/build-examples.mjs --check  fail if a script.js is missing or out of date (writes nothing)
 *
 * Exits with code 1 when an example cannot be loaded, has validation errors, or (with --check) is stale.
 * Plain ESM, no dependencies. Run `npm run build` first when calling it directly.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const examplesDir = path.join(root, "examples");
const check = process.argv.includes("--check");

const buildFile = (f) => path.join(root, "build", f);
if (!existsSync(buildFile("persistence.js"))) {
  console.error("build/ not found: run `npm run build` first (or use `npm run examples`).");
  process.exit(1);
}
const load = (f) => import(pathToFileURL(buildFile(f)).href);
const { parseTopologyFile } = await load("persistence.js");
const { renderScript, formatIssues } = await load("render.js");
const { validate } = await load("validate.js");

const names = readdirSync(examplesDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(path.join(examplesDir, e.name, "topology.json")))
  .map((e) => e.name)
  .sort();

if (!names.length) {
  console.error(`No examples/*/topology.json found in ${examplesDir}.`);
  process.exit(1);
}

let failed = 0;
for (const name of names) {
  const dir = path.join(examplesDir, name);
  const fail = (msg) => {
    failed++;
    console.error(`FAIL ${name}: ${msg}`);
  };

  let topology;
  try {
    ({ topology } = parseTopologyFile(readFileSync(path.join(dir, "topology.json"), "utf8")));
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
    continue;
  }

  const { errors, warnings } = validate(topology);
  if (errors.length) {
    fail(`validation reported ${errors.length} error(s):\n${formatIssues(errors)}`);
    continue;
  }

  // Same bytes as export_script: the script plus a trailing newline.
  const script = `${renderScript(topology).script}\n`;
  const target = path.join(dir, "script.js");
  const current = existsSync(target) ? readFileSync(target, "utf8").replace(/\r\n/g, "\n") : undefined;

  let status;
  if (current === script) status = "up to date";
  else if (check) {
    fail(`script.js is ${current === undefined ? "missing" : "out of date"}; run \`npm run examples\`.`);
    continue;
  } else {
    writeFileSync(target, script, "utf8");
    status = current === undefined ? "written" : "updated";
  }

  console.log(`ok   ${name}: script.js ${status}, ${warnings.length} warning(s)`);
  if (warnings.length) console.log(formatIssues(warnings).replace(/^/gm, "     "));
}

if (failed) {
  console.error(`\n${failed} of ${names.length} example(s) failed.`);
  process.exit(1);
}
console.log(`\n${names.length} example(s) OK.`);
