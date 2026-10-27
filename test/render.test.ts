import { describe, expect, it } from "vitest";
import { generatePTBuilderScript } from "../src/ptbuilder.js";
import { compactJson, formatIssues, issueReport, plural, renderScript } from "../src/render.js";
import { Topology } from "../src/topology.js";
import { cleanLab } from "./helpers.js";

/** Two errors (UNKNOWN_DEVICE for an IOS block and IOS_ON_NON_IOS) plus warnings. */
function broken(): Topology {
  const t = cleanLab();
  t.configs.set("Ghost", ["hostname Ghost"]);
  t.configs.set("PC1", ["hostname PC1"]);
  return t;
}

describe("renderScript", () => {
  it("returns the script with no issues for a clean lab", () => {
    const t = cleanLab();
    expect(renderScript(t)).toEqual({ script: generatePTBuilderScript(t), warnings: [], errors: [] });
  });

  it("throws listing every error unless forced", () => {
    let message = "";
    try {
      renderScript(broken());
    } catch (e) {
      message = (e as Error).message;
    }
    const lines = message.split("\n");
    expect(lines[0]).toBe("The topology has 2 errors; fix them or pass force: true.");
    expect(lines.slice(1)).toEqual([
      expect.stringMatching(/^- ERROR \[UNKNOWN_DEVICE\] IOS commands are stored for "Ghost"/),
      expect.stringMatching(/^- ERROR \[IOS_ON_NON_IOS\] PC1 \(PC-PT\) has IOS commands/),
    ]);
  });

  it("uses the singular for one error", () => {
    const t = cleanLab();
    t.pcIps.set("R1", { name: "R1", dhcp: true });
    expect(() => renderScript(t)).toThrow(/^The topology has 1 error; /);
  });

  it("renders anyway with force, returning the errors", () => {
    const t = broken();
    const r = renderScript(t, { force: true });
    expect(r.script).toBe(generatePTBuilderScript(t));
    expect(r.errors.map((i) => i.code)).toEqual(["UNKNOWN_DEVICE", "IOS_ON_NON_IOS"]);
  });

  it("returns warnings without blocking", () => {
    const t = cleanLab();
    t.addDevice({ name: "MLS1", model: "3650-24PS" });
    const r = renderScript(t);
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((i) => i.code)).toEqual(["POWER_3650", "ISOLATED_DEVICE"]);
  });
});

describe("issueReport", () => {
  it("is undefined without issues", () => {
    expect(issueReport(renderScript(cleanLab()))).toBeUndefined();
  });

  it("lists warnings, or errors and warnings when forced", () => {
    const warned = cleanLab();
    warned.addDevice({ name: "X", model: "PC-PT" });
    expect(issueReport(renderScript(warned))).toBe("Warnings:\n- WARNING [ISOLATED_DEVICE] X has no links.");

    const forced = issueReport(renderScript(broken(), { force: true }))!.split("\n");
    expect(forced[0]).toBe("Generated with force: true despite these issues:");
    expect(forced.slice(1).map((l) => l.slice(0, l.indexOf("]") + 1))).toEqual(["- ERROR [UNKNOWN_DEVICE]", "- ERROR [IOS_ON_NON_IOS]"]);
  });
});

describe("text helpers", () => {
  it("plural", () => {
    expect([plural(0, "link"), plural(1, "link"), plural(2, "link")]).toEqual(["0 links", "1 link", "2 links"]);
  });

  it("formatIssues", () => {
    expect(formatIssues([])).toBe("");
    expect(formatIssues([{ severity: "warning", code: "W", message: "m" }, { severity: "error", code: "E", message: "n" }])).toBe(
      "- WARNING [W] m\n- ERROR [E] n"
    );
  });

  it("compactJson puts one top-level array element per line and drops undefined fields", () => {
    expect(compactJson({ a: 1, list: [{ x: 1 }, { y: "z" }], plain: [1, 2], gone: undefined })).toBe(
      '{\n  "a": 1,\n  "list": [\n    {"x":1},\n    {"y":"z"}\n  ],\n  "plain": [1,2]\n}'
    );
    expect(JSON.parse(compactJson({ a: [{ b: [1, { c: 2 }] }] }))).toEqual({ a: [{ b: [1, { c: 2 }] }] });
  });
});
