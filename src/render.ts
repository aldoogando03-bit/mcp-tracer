/** Validation-gated script rendering (generate_script, export_script) and text helpers. Pure, no MCP imports. */
import { generatePTBuilderScript } from "./ptbuilder.js";
import type { Topology } from "./topology.js";
import { validate, type Issue } from "./validate.js";

/** `errors` is non-empty only when rendering was forced past them. */
export type Rendered = { script: string; warnings: Issue[]; errors: Issue[] };

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const formatIssue = (i: Issue) => `- ${i.severity.toUpperCase()} [${i.code}] ${i.message}`;

/** One "- SEVERITY [CODE] message" line per issue. */
export const formatIssues = (issues: Issue[]) => issues.map(formatIssue).join("\n");

/**
 * Validates and generates the PTBuilder script. Throws when validation reports errors, unless `force`;
 * the message lists every error.
 */
export function renderScript(t: Topology, opts: { force?: boolean } = {}): Rendered {
  const { errors, warnings } = validate(t);
  if (errors.length && !opts.force) {
    throw new Error(`The topology has ${plural(errors.length, "error")}; fix them or pass force: true.\n${formatIssues(errors)}`);
  }
  return { script: generatePTBuilderScript(t), warnings, errors };
}

/** The issue block to show next to a rendered script, or undefined when there is nothing to report. */
export function issueReport(r: Rendered): string | undefined {
  const issues = [...r.errors, ...r.warnings];
  if (!issues.length) return undefined;
  return `${r.errors.length ? "Generated with force: true despite these issues:" : "Warnings:"}\n${formatIssues(issues)}`;
}

/** JSON with the top level indented, one line per element of top-level arrays of objects, everything else inline. */
export function compactJson(obj: Record<string, unknown>): string {
  const val = (v: unknown) =>
    Array.isArray(v) && v.some((x) => typeof x === "object" && x !== null)
      ? `[\n${v.map((x) => `    ${JSON.stringify(x)}`).join(",\n")}\n  ]`
      : JSON.stringify(v);
  return `{\n${Object.entries(obj)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${val(v)}`)
    .join(",\n")}\n}`;
}
