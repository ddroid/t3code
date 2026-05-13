import { ProviderSessionStartInput } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

const decode = Schema.decodeUnknownSync(ProviderSessionStartInput);

describe("schema debug", () => {
  it("empty model", () => {
    expect(() =>
      decode({ threadId: "t1", runtimeMode: "full-access", modelSelection: { model: "" } } as any),
    ).toThrow();
  });
  it("no instanceId", () => {
    expect(() =>
      decode({
        threadId: "t1",
        runtimeMode: "full-access",
        modelSelection: { model: "kimi" },
      } as any),
    ).toThrow();
  });
  it("valid devin", () => {
    expect(
      decode({
        threadId: "t1",
        runtimeMode: "full-access",
        modelSelection: { provider: "devin", model: "kimi-k2.6" },
      } as any),
    ).toBeDefined();
  });
  it("valid instanceId", () => {
    expect(
      decode({
        threadId: "t1",
        runtimeMode: "full-access",
        modelSelection: { instanceId: "devin", model: "kimi-k2.6" },
      } as any),
    ).toBeDefined();
  });
});
