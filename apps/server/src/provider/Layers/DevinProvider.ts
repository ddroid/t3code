import { DevinSettings, ProviderDriverKind, type ServerProviderModel } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  AUTH_PROBE_TIMEOUT_MS,
  DEFAULT_TIMEOUT_MS,
  buildServerProvider,
  detailFromResult,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";

const PROVIDER = ProviderDriverKind.make("devin");
const DEVIN_PRESENTATION = {
  displayName: "Devin",
  showInteractionModeToggle: true,
} as const;

const DEVIN_BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
  { slug: "adaptive", name: "Adaptive", isCustom: false, capabilities: null },
  { slug: "claude-haiku-4.5", name: "Claude Haiku 4.5", isCustom: false, capabilities: null },
  { slug: "claude-opus-4.5", name: "Claude Opus 4.5", isCustom: false, capabilities: null },
  { slug: "claude-opus-4.6", name: "Claude Opus 4.6", isCustom: false, capabilities: null },
  { slug: "claude-opus-4.7", name: "Claude Opus 4.7", isCustom: false, capabilities: null },
  { slug: "claude-sonnet-4.5", name: "Claude Sonnet 4.5", isCustom: false, capabilities: null },
  { slug: "claude-sonnet-4.6", name: "Claude Sonnet 4.6", isCustom: false, capabilities: null },
  { slug: "deepseek-v4", name: "DeepSeek V4", isCustom: false, capabilities: null },
  { slug: "gemini-3-flash", name: "Gemini 3 Flash", isCustom: false, capabilities: null },
  { slug: "gemini-3.1-pro", name: "Gemini 3.1 Pro", isCustom: false, capabilities: null },
  { slug: "glm-5.1", name: "GLM 5.1", isCustom: false, capabilities: null },
  { slug: "gpt-5.2", name: "GPT 5.2", isCustom: false, capabilities: null },
  { slug: "gpt-5.3-codex", name: "GPT 5.3 Codex", isCustom: false, capabilities: null },
  { slug: "gpt-5.4", name: "GPT 5.4", isCustom: false, capabilities: null },
  { slug: "gpt-5.4-mini", name: "GPT 5.4 Mini", isCustom: false, capabilities: null },
  { slug: "gpt-5.5", name: "GPT 5.5", isCustom: false, capabilities: null },
  { slug: "kimi-k2.6", name: "Kimi K2.6", isCustom: false, capabilities: null },
  { slug: "swe-1.5", name: "SWE 1.5", isCustom: false, capabilities: null },
  { slug: "swe-1.6", name: "SWE 1.6", isCustom: false, capabilities: null },
];

function runDevinCommand(
  binaryPath: string,
  args: ReadonlyArray<string>,
  environment?: NodeJS.ProcessEnv,
) {
  const command = ChildProcess.make(binaryPath, [...args], {
    env: environment ?? process.env,
    shell: process.platform === "win32",
  });
  return spawnAndCollect(binaryPath, command);
}

export const makePendingDevinProvider = (
  devinSettings: DevinSettings,
): Effect.Effect<ServerProviderDraft> =>
  Effect.gen(function* () {
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    const models = providerModelsFromSettings(
      DEVIN_BUILT_IN_MODELS,
      PROVIDER,
      devinSettings.customModels,
      { optionDescriptors: [] },
    );

    if (!devinSettings.enabled) {
      return buildServerProvider({
        presentation: DEVIN_PRESENTATION,
        enabled: false,
        checkedAt,
        models,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Devin is disabled in T3 Code settings.",
        },
      });
    }

    return buildServerProvider({
      presentation: DEVIN_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Devin provider status has not been checked in this session yet.",
      },
    });
  });

export const checkDevinProviderStatus = Effect.fn("checkDevinProviderStatus")(function* (
  devinSettings: DevinSettings,
  environment: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<ServerProviderDraft, never, ChildProcessSpawner.ChildProcessSpawner> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const allModels = providerModelsFromSettings(
    DEVIN_BUILT_IN_MODELS,
    PROVIDER,
    devinSettings.customModels,
    { optionDescriptors: [] },
  );

  if (!devinSettings.enabled) {
    return buildServerProvider({
      presentation: DEVIN_PRESENTATION,
      enabled: false,
      checkedAt,
      models: allModels,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Devin is disabled in T3 Code settings.",
      },
    });
  }

  // Probe version
  const versionProbe = yield* runDevinCommand(
    devinSettings.binaryPath,
    ["version"],
    environment,
  ).pipe(Effect.timeoutOption(DEFAULT_TIMEOUT_MS), Effect.result);

  if (Result.isFailure(versionProbe)) {
    const error = versionProbe.failure;
    return buildServerProvider({
      presentation: DEVIN_PRESENTATION,
      enabled: devinSettings.enabled,
      checkedAt,
      models: allModels,
      probe: {
        installed: !isCommandMissingCause(error),
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: isCommandMissingCause(error)
          ? "Devin CLI (`devin`) is not installed or not on PATH."
          : `Failed to execute Devin CLI health check: ${error instanceof Error ? error.message : String(error)}.`,
      },
    });
  }

  if (Option.isNone(versionProbe.success)) {
    return buildServerProvider({
      presentation: DEVIN_PRESENTATION,
      enabled: devinSettings.enabled,
      checkedAt,
      models: allModels,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: "Devin CLI is installed but timed out while running `devin version`.",
      },
    });
  }

  const versionResult = versionProbe.success.value;
  const version = parseGenericCliVersion(`${versionResult.stdout}\n${versionResult.stderr}`);
  if (versionResult.code !== 0) {
    const detail = detailFromResult(versionResult);
    return buildServerProvider({
      presentation: DEVIN_PRESENTATION,
      enabled: devinSettings.enabled,
      checkedAt,
      models: allModels,
      probe: {
        installed: true,
        version,
        status: "error",
        auth: { status: "unknown" },
        message: detail
          ? `Devin CLI is installed but failed to run \`devin version\`. ${detail}`
          : "Devin CLI is installed but failed to run `devin version`.",
      },
    });
  }

  // Probe auth status
  const authProbe = yield* runDevinCommand(
    devinSettings.binaryPath,
    ["auth", "status"],
    environment,
  ).pipe(Effect.timeoutOption(AUTH_PROBE_TIMEOUT_MS), Effect.result);

  if (Result.isFailure(authProbe)) {
    return buildServerProvider({
      presentation: DEVIN_PRESENTATION,
      enabled: devinSettings.enabled,
      checkedAt,
      models: allModels,
      probe: {
        installed: true,
        version,
        status: "error",
        auth: { status: "unknown" },
        message: `Failed to check Devin auth status: ${authProbe.failure instanceof Error ? authProbe.failure.message : String(authProbe.failure)}.`,
      },
    });
  }

  if (Option.isNone(authProbe.success)) {
    return buildServerProvider({
      presentation: DEVIN_PRESENTATION,
      enabled: devinSettings.enabled,
      checkedAt,
      models: allModels,
      probe: {
        installed: true,
        version,
        status: "error",
        auth: { status: "unknown" },
        message: "Timed out while checking Devin auth status.",
      },
    });
  }

  const authResult = authProbe.success.value;
  // `devin auth status` exits 0 when authenticated and non-zero when not.
  // The CLI emits human-readable plain text rather than JSON, so the
  // exit code is the authoritative signal.
  const isAuthenticated = authResult.code === 0;

  if (!isAuthenticated) {
    return buildServerProvider({
      presentation: DEVIN_PRESENTATION,
      enabled: devinSettings.enabled,
      checkedAt,
      models: allModels,
      probe: {
        installed: true,
        version,
        status: "error",
        auth: { status: "unauthenticated" },
        message: "Devin CLI is not authenticated. Run `devin login` and try again.",
      },
    });
  }

  return buildServerProvider({
    presentation: DEVIN_PRESENTATION,
    enabled: devinSettings.enabled,
    checkedAt,
    models: allModels,
    probe: {
      installed: true,
      version,
      status: "ready",
      auth: { status: "authenticated" },
    },
  });
});
