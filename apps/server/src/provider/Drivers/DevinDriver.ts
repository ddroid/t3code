/**
 * DevinDriver — `ProviderDriver` for the Devin CLI.
 *
 *   - Snapshot probes `devin version` and `devin auth status`.
 *   - Maintenance is manual-only (no automated update command).
 *   - Sessions run through ACP-over-stdio via `devin acp`.
 *   - Text generation is stubbed out as unsupported.
 *
 * @module provider/Drivers/DevinDriver
 */
import {
  DevinSettings,
  ProviderDriverKind,
  type ServerProvider,
  TextGenerationError,
} from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

import { ProviderDriverError } from "../Errors.ts";
import { checkDevinProviderStatus, makePendingDevinProvider } from "../Layers/DevinProvider.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import { makeDevinAdapter } from "../Layers/DevinAdapter.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import type { ServerProviderDraft } from "../providerSnapshot.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import {
  makeManualOnlyProviderMaintenanceCapabilities,
  makeStaticProviderMaintenanceResolver,
  resolveProviderMaintenanceCapabilitiesEffect,
} from "../providerMaintenance.ts";
import type { TextGenerationShape } from "../../textGeneration/TextGeneration.ts";

const decodeDevinSettings = Schema.decodeSync(DevinSettings);

const DRIVER_KIND = ProviderDriverKind.make("devin");
const SNAPSHOT_REFRESH_INTERVAL = Duration.minutes(5);
const UPDATE = makeStaticProviderMaintenanceResolver(
  makeManualOnlyProviderMaintenanceCapabilities({
    provider: DRIVER_KIND,
    packageName: null,
  }),
);

const unsupportedTextGenerationError = (operation: string) =>
  new TextGenerationError({
    operation,
    detail: "Devin text generation is not yet supported.",
  });

const makeDevinTextGeneration = (): TextGenerationShape => ({
  generateCommitMessage: () => Effect.fail(unsupportedTextGenerationError("generateCommitMessage")),
  generatePrContent: () => Effect.fail(unsupportedTextGenerationError("generatePrContent")),
  generateBranchName: () => Effect.fail(unsupportedTextGenerationError("generateBranchName")),
  generateThreadTitle: () => Effect.fail(unsupportedTextGenerationError("generateThreadTitle")),
});

const withInstanceIdentity =
  (input: {
    readonly instanceId: ProviderInstance["instanceId"];
    readonly displayName: string | undefined;
    readonly accentColor: string | undefined;
    readonly continuationGroupKey: string;
  }) =>
  (snapshot: ServerProviderDraft): ServerProvider => ({
    ...snapshot,
    instanceId: input.instanceId,
    driver: DRIVER_KIND,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    continuation: { groupKey: input.continuationGroupKey },
  });

export type DevinDriverEnv = ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem;

export const DevinDriver: ProviderDriver<DevinSettings, DevinDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "Devin",
    supportsMultipleInstances: true,
  },
  configSchema: DevinSettings,
  defaultConfig: (): DevinSettings => decodeDevinSettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const _fileSystem = yield* FileSystem.FileSystem;
      const processEnv = mergeProviderInstanceEnvironment(environment);
      const continuationIdentity = defaultProviderContinuationIdentity({
        driverKind: DRIVER_KIND,
        instanceId,
      });
      const stampIdentity = withInstanceIdentity({
        instanceId,
        displayName,
        accentColor,
        continuationGroupKey: continuationIdentity.continuationKey,
      });
      const effectiveConfig = { ...config, enabled } satisfies DevinSettings;
      const maintenanceCapabilities = yield* resolveProviderMaintenanceCapabilitiesEffect(UPDATE, {
        binaryPath: effectiveConfig.binaryPath,
        env: processEnv,
      });

      const adapter = yield* makeDevinAdapter(effectiveConfig, {
        instanceId,
        environment: processEnv,
      });
      const textGeneration = makeDevinTextGeneration();

      const checkProvider = checkDevinProviderStatus(effectiveConfig).pipe(
        Effect.map(stampIdentity),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      );

      const snapshot = yield* makeManagedServerProvider<DevinSettings>({
        maintenanceCapabilities,
        getSettings: Effect.succeed(effectiveConfig),
        streamSettings: Stream.never,
        haveSettingsChanged: () => false,
        initialSnapshot: (settings) =>
          makePendingDevinProvider(settings).pipe(Effect.map(stampIdentity)),
        checkProvider,
        refreshInterval: SNAPSHOT_REFRESH_INTERVAL,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to build Devin snapshot: ${cause.message ?? String(cause)}`,
              cause,
            }),
        ),
      );

      return {
        instanceId,
        driverKind: DRIVER_KIND,
        continuationIdentity,
        displayName,
        accentColor,
        enabled,
        snapshot,
        adapter,
        textGeneration,
      } satisfies ProviderInstance;
    }),
};
