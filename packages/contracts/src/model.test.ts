import { describe, expect, it } from "vitest";

import {
  DEFAULT_MODEL,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  MODEL_SLUG_ALIASES_BY_PROVIDER,
  PROVIDER_DISPLAY_NAMES,
} from "./model.ts";
import { ProviderDriverKind } from "./providerInstance.ts";

describe("provider model constants", () => {
  const devinDriver = ProviderDriverKind.make("devin");

  it("includes Devin in DEFAULT_MODEL_BY_PROVIDER", () => {
    expect(DEFAULT_MODEL_BY_PROVIDER[devinDriver]).toBe("kimi-k2.6");
  });

  it("includes Devin in DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER", () => {
    expect(DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER[devinDriver]).toBe("swe-1.6");
  });

  it("includes Devin in MODEL_SLUG_ALIASES_BY_PROVIDER", () => {
    expect(MODEL_SLUG_ALIASES_BY_PROVIDER[devinDriver]).toEqual({});
  });

  it("includes Devin in PROVIDER_DISPLAY_NAMES", () => {
    expect(PROVIDER_DISPLAY_NAMES[devinDriver]).toBe("Devin");
  });

  it("retains the global default model constants", () => {
    expect(DEFAULT_MODEL).toBe("gpt-5.4");
  });
});
