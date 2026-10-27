/**
 * Type-level tests, run by vitest's typecheck mode (tsc -p test/tsconfig.json). Because that tsc run covers
 * src/, test/ and vitest.config.ts, a type error in any test file also fails `npm test`.
 */
import { describe, expectTypeOf, it } from "vitest";
import { CABLE_TYPES, inferCable, type CableType } from "../src/cables.js";
import { resolveModel, type ModelInfo } from "../src/catalog.js";
import { generatePTBuilderScript } from "../src/ptbuilder.js";
import { renderScript, type Rendered } from "../src/render.js";
import { Topology, type TopologyJSON } from "../src/topology.js";
import { validate, type Issue } from "../src/validate.js";

describe("public types", () => {
  it("cables are a closed union without wireless", () => {
    expectTypeOf<CableType>().toEqualTypeOf<(typeof CABLE_TYPES)[number]>();
    expectTypeOf<"straight">().toExtend<CableType>();
    expectTypeOf<"wireless">().not.toExtend<CableType>();
    expectTypeOf(inferCable).returns.toEqualTypeOf<CableType>();
  });

  it("the generator and renderer take a Topology", () => {
    expectTypeOf(generatePTBuilderScript).parameters.toEqualTypeOf<[Topology]>();
    expectTypeOf(generatePTBuilderScript).returns.toBeString();
    expectTypeOf(renderScript).returns.toEqualTypeOf<Rendered>();
  });

  it("validation issues carry a severity union and an optional device", () => {
    expectTypeOf(validate).returns.toEqualTypeOf<{ errors: Issue[]; warnings: Issue[] }>();
    expectTypeOf<Issue["severity"]>().toEqualTypeOf<"error" | "warning">();
    expectTypeOf<Issue["device"]>().toEqualTypeOf<string | undefined>();
  });

  it("serialized topologies are versioned", () => {
    expectTypeOf<Topology["toJSON"]>().returns.toEqualTypeOf<TopologyJSON>();
    expectTypeOf<TopologyJSON["version"]>().toEqualTypeOf<1>();
    expectTypeOf(Topology.fromJSON).parameters.toEqualTypeOf<[unknown]>();
  });

  it("resolveModel may fail and only sometimes has catalog info", () => {
    expectTypeOf(resolveModel).returns.toEqualTypeOf<{ model: string; info?: ModelInfo } | undefined>();
  });
});
