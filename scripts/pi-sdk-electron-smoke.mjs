import { app } from "electron";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.PI_OFFLINE = "1";

const MODEL = {
  id: "smoke-model",
  name: "Smoke Model",
  api: "openai-completions",
  provider: "smoke",
  baseUrl: "",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 4096,
  maxTokens: 256,
};

function writeChunk(response, delta, finishReason = null, usage) {
  response.write(
    `data: ${JSON.stringify({
      id: "chatcmpl-smoke",
      object: "chat.completion.chunk",
      created: 0,
      model: MODEL.id,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
      ...(usage ? { usage } : {}),
    })}\n\n`,
  );
}

async function main() {
  const { createProvider } = await import("@earendil-works/pi-ai");
  const openAICompletionsApi =
    await import("@earendil-works/pi-ai/api/openai-completions");
  const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");

  const root = await mkdtemp(join(tmpdir(), "deskwand-pi-smoke-"));
  const authPath = join(root, "auth.json");
  let server;

  try {
    await writeFile(
      authPath,
      JSON.stringify({
        smoke: {
          type: "oauth",
          access: "expired-access",
          refresh: "refresh-token",
          expires: 0,
        },
        "smoke-fail": {
          type: "oauth",
          access: "original-access",
          refresh: "refresh-token",
          expires: 0,
        },
      }),
      { mode: 0o600 },
    );

    server = createServer((request, response) => {
      if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
        response.writeHead(404).end();
        return;
      }
      if (request.headers.authorization !== "Bearer smoke-key") {
        response.writeHead(401).end();
        return;
      }
      request.resume();
      request.on("end", () => {
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
        });
        writeChunk(response, { role: "assistant", content: "" });
        writeChunk(response, { content: "smoke-ok" });
        writeChunk(response, {}, "stop", {
          prompt_tokens: 1,
          completion_tokens: 1,
          total_tokens: 2,
        });
        response.end("data: [DONE]\n\n");
      });
    });

    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Loopback server did not expose a TCP port");
    }

    const invalidAuthPath = join(root, "invalid-auth.json");
    await writeFile(invalidAuthPath, "{invalid", { mode: 0o600 });
    await ModelRuntime.create({
      authPath: invalidAuthPath,
      modelsPath: null,
      allowModelNetwork: false,
    });
    if ((await readFile(invalidAuthPath, "utf8")) !== "{invalid") {
      throw new Error(
        "Invalid auth.json was overwritten during initialization",
      );
    }

    const runtime = await ModelRuntime.create({
      authPath,
      modelsPath: null,
      allowModelNetwork: false,
    });
    const api = {
      stream: openAICompletionsApi.stream,
      streamSimple: openAICompletionsApi.streamSimple,
    };

    runtime.registerNativeProvider(
      createProvider({
        id: "smoke",
        name: "Smoke",
        auth: {
          oauth: {
            name: "Smoke OAuth",
            async login() {
              throw new Error("Smoke login is not used");
            },
            async refresh(credential, _signal) {
              return {
                ...credential,
                access: "smoke-key",
                expires: Date.now() + 60_000,
              };
            },
            async toAuth(credential) {
              return { apiKey: credential.access };
            },
          },
        },
        models: [
          {
            ...MODEL,
            baseUrl: `http://127.0.0.1:${address.port}/v1`,
          },
        ],
        api,
      }),
    );

    runtime.registerNativeProvider(
      createProvider({
        id: "smoke-fail",
        name: "Smoke Refresh Failure",
        auth: {
          oauth: {
            name: "Smoke Refresh Failure",
            async login() {
              throw new Error("Smoke login is not used");
            },
            async refresh() {
              throw new Error("expected refresh failure");
            },
            async toAuth(credential) {
              return { apiKey: credential.access };
            },
          },
        },
        models: [],
        api,
      }),
    );

    await runtime.getAuth("smoke-fail").then(
      () => {
        throw new Error("Failed OAuth refresh unexpectedly succeeded");
      },
      () => undefined,
    );
    const afterFailedRefresh = JSON.parse(await readFile(authPath, "utf8"));
    if (afterFailedRefresh["smoke-fail"].access !== "original-access") {
      throw new Error("Failed OAuth refresh replaced the original credential");
    }

    const model = runtime.getModel("smoke", MODEL.id);
    if (!model) throw new Error("Smoke model was not registered");
    const result = await runtime.completeSimple(model, {
      messages: [{ role: "user", content: "ping", timestamp: Date.now() }],
    });
    const text = result.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
    if (result.stopReason !== "stop" || text !== "smoke-ok") {
      throw new Error(`Unexpected smoke response: ${result.stopReason}`);
    }

    const afterSuccessfulRefresh = JSON.parse(await readFile(authPath, "utf8"));
    if (afterSuccessfulRefresh.smoke.access !== "smoke-key") {
      throw new Error("Successful OAuth refresh was not persisted");
    }

    await runtime.logout("smoke");
    const stored = JSON.parse(await readFile(authPath, "utf8"));
    if (stored.smoke !== undefined) {
      throw new Error("Smoke credential was not removed on logout");
    }

    console.log(`pi-sdk-electron-smoke: ok (Node ${process.versions.node})`);
  } finally {
    if (server?.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
    await rm(root, { recursive: true, force: true });
  }
}

app
  .whenReady()
  .then(main)
  .then(
    () => app.exit(0),
    (error) => {
      console.error(
        "pi-sdk-electron-smoke: failed",
        error instanceof Error ? error.message : String(error),
      );
      app.exit(1);
    },
  );
