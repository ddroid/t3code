import { assert, describe, it } from "@effect/vitest";
import { DevinSettings, ProviderDriverKind } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

import { checkDevinProviderStatus, makePendingDevinProvider } from "./DevinProvider.ts";

const decodeDevinSettings = Schema.decodeSync(DevinSettings);
const DRIVER = ProviderDriverKind.make("devin");
const encoder = new TextEncoder();

function mockHandle(result: {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly code?: number;
}) {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(result.code ?? 0)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    unref: Effect.succeed(Effect.void),
    stdin: Sink.drain,
    stdout: Stream.make(encoder.encode(result.stdout ?? "")),
    stderr: Stream.make(encoder.encode(result.stderr ?? "")),
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });
}

function mockSpawnerLayer(
  handler: (
    command: string,
    args: ReadonlyArray<string>,
  ) => {
    readonly stdout?: string;
    readonly stderr?: string;
    readonly code?: number;
  },
) {
  return Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) => {
      const childProcess = command as unknown as {
        readonly command: string;
        readonly args: ReadonlyArray<string>;
      };
      try {
        return Effect.succeed(mockHandle(handler(childProcess.command, childProcess.args)));
      } catch {
        return Effect.fail(
          PlatformError.systemError({
            _tag: "NotFound",
            module: "ChildProcess",
            method: "spawn",
            description: `spawn ${childProcess.command} ENOENT`,
          }),
        );
      }
    }),
  );
}

describe("makePendingDevinProvider", () => {
  it.effect("returns a disabled snapshot when Devin is disabled", () =>
    Effect.gen(function* () {
      const snapshot = yield* makePendingDevinProvider(decodeDevinSettings({ enabled: false }));
      assert.strictEqual(snapshot.enabled, false);
      assert.strictEqual(snapshot.status, "disabled");
      assert.strictEqual(snapshot.auth.status, "unknown");
    }),
  );

  it.effect("returns a pending snapshot with built-in models", () =>
    Effect.gen(function* () {
      const snapshot = yield* makePendingDevinProvider(decodeDevinSettings({}));
      assert.strictEqual(snapshot.enabled, true);
      assert.strictEqual(snapshot.status, "warning");
      assert.strictEqual(snapshot.models.length, 2);
      assert.ok(snapshot.models.some((m) => m.slug === "kimi-k2.6"));
      assert.ok(snapshot.models.some((m) => m.slug === "swe-1.6"));
    }),
  );

  it.effect("includes custom models in the pending snapshot", () =>
    Effect.gen(function* () {
      const snapshot = yield* makePendingDevinProvider(
        decodeDevinSettings({ customModels: ["custom-devin-model"] }),
      );
      assert.ok(snapshot.models.some((m) => m.slug === "custom-devin-model"));
    }),
  );
});

describe("checkDevinProviderStatus", () => {
  it.effect("reports not installed when the binary is missing", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkDevinProviderStatus(decodeDevinSettings({}));
      assert.strictEqual(snapshot.installed, false);
      assert.strictEqual(snapshot.status, "error");
      assert.strictEqual(snapshot.auth.status, "unknown");
      assert.include(snapshot.message ?? "", "not installed");
    }).pipe(
      Effect.provide(
        mockSpawnerLayer(() => {
          throw new Error("spawn devin ENOENT");
        }),
      ),
    ),
  );

  it.effect("reports ready when version and auth both succeed", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkDevinProviderStatus(decodeDevinSettings({}));
      assert.strictEqual(snapshot.installed, true);
      assert.strictEqual(snapshot.version, "1.0.0");
      assert.strictEqual(snapshot.status, "ready");
      assert.strictEqual(snapshot.auth.status, "authenticated");
    }).pipe(
      Effect.provide(
        mockSpawnerLayer((_command, args) => {
          if (args[0] === "version") {
            return { stdout: "devin version 1.0.0\n" };
          }
          if (args[0] === "auth" && args[1] === "status") {
            return { stdout: JSON.stringify({ authenticated: true }) };
          }
          return { stdout: "" };
        }),
      ),
    ),
  );

  it.effect("reports unauthenticated when auth says not logged in", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkDevinProviderStatus(decodeDevinSettings({}));
      assert.strictEqual(snapshot.installed, true);
      assert.strictEqual(snapshot.status, "error");
      assert.strictEqual(snapshot.auth.status, "unauthenticated");
      assert.include(snapshot.message ?? "", "not authenticated");
    }).pipe(
      Effect.provide(
        mockSpawnerLayer((_command, args) => {
          if (args[0] === "version") {
            return { stdout: "devin version 1.0.0\n" };
          }
          if (args[0] === "auth" && args[1] === "status") {
            return { stdout: JSON.stringify({ authenticated: false }) };
          }
          return { stdout: "" };
        }),
      ),
    ),
  );

  it.effect("reports disabled when settings have enabled=false", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkDevinProviderStatus(decodeDevinSettings({ enabled: false }));
      assert.strictEqual(snapshot.enabled, false);
      assert.strictEqual(snapshot.status, "disabled");
    }).pipe(Effect.provide(mockSpawnerLayer(() => ({ stdout: "" })))),
  );
});
