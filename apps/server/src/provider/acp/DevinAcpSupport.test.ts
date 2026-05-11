import { DevinSettings } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { buildDevinAcpSpawnInput } from "./DevinAcpSupport.ts";

const decodeDevinSettings = Schema.decodeSync(DevinSettings);

describe("buildDevinAcpSpawnInput", () => {
  it("builds the default Devin ACP command", () => {
    expect(buildDevinAcpSpawnInput(decodeDevinSettings({}), "/tmp/project")).toEqual({
      command: "devin",
      args: ["acp"],
      cwd: "/tmp/project",
    });
  });

  it("uses the configured binary path when present", () => {
    expect(
      buildDevinAcpSpawnInput(
        decodeDevinSettings({ binaryPath: "/usr/local/bin/devin" }),
        "/tmp/project",
      ),
    ).toEqual({
      command: "/usr/local/bin/devin",
      args: ["acp"],
      cwd: "/tmp/project",
    });
  });

  it("includes --config when configPath is set", () => {
    expect(
      buildDevinAcpSpawnInput(
        decodeDevinSettings({ configPath: "~/.config/devin" }),
        "/tmp/project",
      ),
    ).toEqual({
      command: "devin",
      args: ["acp", "--config", "~/.config/devin"],
      cwd: "/tmp/project",
    });
  });

  it("includes --permission-mode when permissionMode is set", () => {
    expect(
      buildDevinAcpSpawnInput(decodeDevinSettings({ permissionMode: "auto" }), "/tmp/project"),
    ).toEqual({
      command: "devin",
      args: ["acp", "--permission-mode", "auto"],
      cwd: "/tmp/project",
    });
  });

  it("propagates environment when provided", () => {
    expect(
      buildDevinAcpSpawnInput(decodeDevinSettings({}), "/tmp/project", { DEVIN_API_KEY: "secret" }),
    ).toEqual({
      command: "devin",
      args: ["acp"],
      cwd: "/tmp/project",
      env: { DEVIN_API_KEY: "secret" },
    });
  });

  it("combines all optional arguments", () => {
    expect(
      buildDevinAcpSpawnInput(
        decodeDevinSettings({
          binaryPath: "/opt/devin",
          configPath: "/custom/config",
          permissionMode: "disabled",
        }),
        "/workspace",
        { FOO: "bar" },
      ),
    ).toEqual({
      command: "/opt/devin",
      args: ["acp", "--config", "/custom/config", "--permission-mode", "disabled"],
      cwd: "/workspace",
      env: { FOO: "bar" },
    });
  });
});
