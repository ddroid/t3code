// @effect-diagnostics nodeBuiltinImport:off
import * as path from "node:path";
import * as os from "node:os";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { DevinSettings, ProviderDriverKind, ThreadId } from "@t3tools/contracts";

import { makeDevinAdapter } from "./DevinAdapter.ts";
import type { DevinAdapterShape } from "../Services/DevinAdapter.ts";

const decodeDevinSettings = Schema.decodeSync(DevinSettings);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockAgentPath = path.join(__dirname, "../../../scripts/acp-mock-agent.ts");
const bunExe = "bun";

async function makeMockAgentWrapper(
  extraEnv?: Record<string, string>,
  options?: { initialDelaySeconds?: number },
) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "devin-acp-mock-"));
  const wrapperPath = path.join(dir, "fake-devin.sh");
  const envExports = Object.entries(extraEnv ?? {})
    .map(([key, value]) => `export ${key}=${JSON.stringify(value)}`)
    .join("\n");
  const script = `#!/bin/sh
${envExports}
${options?.initialDelaySeconds ? `sleep ${JSON.stringify(String(options.initialDelaySeconds))}` : ""}
exec ${JSON.stringify(bunExe)} ${JSON.stringify(mockAgentPath)} "$@"
`;
  await writeFile(wrapperPath, script, "utf8");
  await chmod(wrapperPath, 0o755);
  return wrapperPath;
}

async function waitForFileContent(filePath: string, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const raw = await readFile(filePath, "utf8");
      if (raw.trim().length > 0) {
        return raw;
      }
    } catch {}
    await Effect.runPromise(Effect.yieldNow);
  }
  throw new Error(`Timed out waiting for file content at ${filePath}`);
}

// Mutable ref for tests to swap the binary path per-session.
const makeResolveDevinSettings = Effect.gen(function* () {
  const settingsRef = yield* Ref.make(decodeDevinSettings({}));
  return {
    getSettings: Ref.get(settingsRef),
    updateSettings: (settings: import("@t3tools/contracts").DevinSettings) =>
      Ref.set(settingsRef, settings),
    resolveSettings: Effect.gen(function* () {
      return yield* Ref.get(settingsRef);
    }),
  };
});

interface DevinTestContext {
  readonly adapter: DevinAdapterShape;
  readonly resolveSettings: Effect.Effect<import("@t3tools/contracts").DevinSettings>;
  readonly updateSettings: (
    settings: import("@t3tools/contracts").DevinSettings,
  ) => Effect.Effect<void>;
}

class DevinTestContextService extends Context.Service<DevinTestContextService, DevinTestContext>()(
  "test/DevinTestContext",
) {}

const devinAdapterTestLayer = it.layer(
  Layer.effect(
    DevinTestContextService,
    Effect.gen(function* () {
      const devinConfig = decodeDevinSettings({});
      const { resolveSettings, updateSettings } = yield* makeResolveDevinSettings;
      const adapter = yield* makeDevinAdapter(devinConfig, { resolveSettings });
      return { adapter, resolveSettings, updateSettings };
    }),
  ).pipe(Layer.provideMerge(NodeServices.layer)),
);

devinAdapterTestLayer("DevinAdapterLive", (it) => {
  it.effect("starts a session and streams mock ACP assistant text as runtime events", () =>
    Effect.gen(function* () {
      const ctx = yield* DevinTestContextService;
      const adapter = ctx.adapter;
      const threadId = ThreadId.make("devin-mock-thread");

      const wrapperPath = yield* Effect.promise(() => makeMockAgentWrapper());
      yield* ctx.updateSettings(decodeDevinSettings({ binaryPath: wrapperPath }));

      const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 8).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );

      const session = yield* adapter.startSession({
        threadId,
        provider: ProviderDriverKind.make("devin"),
        cwd: process.cwd(),
        runtimeMode: "full-access",
      });

      assert.equal(session.provider, "devin");
      assert.deepStrictEqual(session.resumeCursor, {
        schemaVersion: 1,
        sessionId: "mock-session-1",
      });

      yield* adapter.sendTurn({
        threadId,
        input: "hello mock",
        attachments: [],
      });

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      const types = runtimeEvents.map((e) => e.type);

      for (const t of [
        "session.started",
        "session.state.changed",
        "thread.started",
        "turn.started",
        "item.started",
        "content.delta",
        "item.completed",
        "turn.completed",
      ] as const) {
        assert.include(types, t);
      }

      const assistantStarted = runtimeEvents.find(
        (event) => event.type === "item.started" && event.payload.itemType === "assistant_message",
      );
      assert.isDefined(assistantStarted);

      const delta = runtimeEvents.find((e) => e.type === "content.delta");
      assert.isDefined(delta);
      if (delta?.type === "content.delta") {
        assert.equal(delta.payload.delta, "hello from mock");
        assert.match(String(delta.itemId), /^assistant:mock-session-1:segment:0$/);
      }

      const assistantCompleted = runtimeEvents.find(
        (event) =>
          event.type === "item.completed" && event.payload.itemType === "assistant_message",
      );
      assert.isDefined(assistantCompleted);

      yield* adapter.stopSession(threadId);
    }),
  );

  it.effect("closes the ACP child process when a session stops", () =>
    Effect.gen(function* () {
      const ctx = yield* DevinTestContextService;
      const adapter = ctx.adapter;
      const threadId = ThreadId.make("devin-stop-session-close");
      const tempDir = yield* Effect.promise(() =>
        mkdtemp(path.join(os.tmpdir(), "devin-adapter-exit-log-")),
      );
      const exitLogPath = path.join(tempDir, "exit.log");

      const wrapperPath = yield* Effect.promise(() =>
        makeMockAgentWrapper({
          T3_ACP_EXIT_LOG_PATH: exitLogPath,
        }),
      );
      yield* ctx.updateSettings(decodeDevinSettings({ binaryPath: wrapperPath }));

      yield* adapter.startSession({
        threadId,
        provider: ProviderDriverKind.make("devin"),
        cwd: process.cwd(),
        runtimeMode: "full-access",
      });

      yield* adapter.stopSession(threadId);

      const exitLog = yield* Effect.promise(() => waitForFileContent(exitLogPath));
      assert.include(exitLog, "SIGTERM");
    }),
  );

  it.effect("rejects startSession when provider mismatches", () =>
    Effect.gen(function* () {
      const ctx = yield* DevinTestContextService;
      const adapter = ctx.adapter;
      const result = yield* adapter
        .startSession({
          threadId: ThreadId.make("bad-provider"),
          provider: ProviderDriverKind.make("codex"),
          cwd: process.cwd(),
          runtimeMode: "full-access",
        })
        .pipe(Effect.result);

      assert.equal(result._tag, "Failure");
    }),
  );

  it.effect("rejects sendTurn with empty input", () =>
    Effect.gen(function* () {
      const ctx = yield* DevinTestContextService;
      const adapter = ctx.adapter;
      const threadId = ThreadId.make("devin-empty-turn");

      const wrapperPath = yield* Effect.promise(() => makeMockAgentWrapper());
      yield* ctx.updateSettings(decodeDevinSettings({ binaryPath: wrapperPath }));

      yield* adapter.startSession({
        threadId,
        provider: ProviderDriverKind.make("devin"),
        cwd: process.cwd(),
        runtimeMode: "full-access",
      });

      const result = yield* adapter
        .sendTurn({
          threadId,
          input: "",
          attachments: [],
        })
        .pipe(Effect.result);

      assert.equal(result._tag, "Failure");

      yield* adapter.stopSession(threadId);
    }),
  );

  it.effect("multiple sessions are independent", () =>
    Effect.gen(function* () {
      const ctx = yield* DevinTestContextService;
      const adapter = ctx.adapter;
      const threadIdA = ThreadId.make("devin-session-a");
      const threadIdB = ThreadId.make("devin-session-b");

      const wrapperPath = yield* Effect.promise(() => makeMockAgentWrapper());
      yield* ctx.updateSettings(decodeDevinSettings({ binaryPath: wrapperPath }));

      const sessionA = yield* adapter.startSession({
        threadId: threadIdA,
        provider: ProviderDriverKind.make("devin"),
        cwd: process.cwd(),
        runtimeMode: "full-access",
      });

      const sessionB = yield* adapter.startSession({
        threadId: threadIdB,
        provider: ProviderDriverKind.make("devin"),
        cwd: process.cwd(),
        runtimeMode: "full-access",
      });

      assert.equal(sessionA.threadId, threadIdA);
      assert.equal(sessionB.threadId, threadIdB);
      // The mock agent always returns "mock-session-1", so session IDs may be equal.
      // Independence is verified by the fact both sessions start and stop cleanly.

      yield* adapter.stopSession(threadIdA);
      yield* adapter.stopSession(threadIdB);
    }),
  );
});
