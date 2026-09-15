"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

async function freePort() {
  return await new Promise((resolve, reject) => {
    const probe = net.createServer();

    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = Number(address?.port);

      probe.close(error => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

async function waitForHealth(url, child, timeoutMs = 12_000) {
  const started = Date.now();
  let lastError = null;

  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(
        `Le serveur s'est arrêté avant /health (code ${child.exitCode}).`
      );
    }

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(1200)
      });

      if (response.ok) {
        return await response.json();
      }

      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise(resolve => setTimeout(resolve, 180));
  }

  throw lastError || new Error("Timeout /health.");
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;

  child.kill("SIGTERM");

  await Promise.race([
    new Promise(resolve => child.once("exit", resolve)),
    new Promise(resolve => setTimeout(resolve, 2000))
  ]);

  if (child.exitCode === null) {
    child.kill("SIGKILL");
  }
}

test(
  "le serveur démarre et répond sur /health",
  { timeout: 20_000 },
  async () => {
    const port = await freePort();
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "ptitbac-smoke-")
    );

    const walletFile = path.join(tempDir, "wallets.json");

    const child = spawn(
      process.execPath,
      ["server.js"],
      {
        cwd: __dirname,
        env: {
          ...process.env,
          PORT: String(port),
          DATABASE_URL: "",
          OPENAI_API_KEY: "",
          OPENAI_BOT_API_KEY: "",
          BOT_AI_ENABLED: "false",
          RENDER: "false",
          PTITBAC_WALLET_FILE: walletFile
        },
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", chunk => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", chunk => {
      stderr += chunk.toString();
    });

    try {
      const health = await waitForHealth(
        `http://127.0.0.1:${port}/health`,
        child
      );

      assert.equal(health?.ok, true);
      assert.equal(typeof health?.version, "string");
      assert.match(health.version, /^\d+\.\d+\.\d+$/);
      assert.equal(health?.environment, "local");
      assert.equal(health?.databaseReady, false);
      assert.equal(health?.storage, "json");
      assert.equal(health?.database, "json");
      assert.equal(health?.commit, null);
      assert.equal(typeof health?.uptimeSeconds, "number");
    } catch (error) {
      throw new Error(
        `${error.message}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`
      );
    } finally {
      await stopChild(child);
      fs.rmSync(tempDir, {
        recursive: true,
        force: true
      });
    }
  }
);


test(
  "sur Render le serveur refuse de démarrer sans PostgreSQL",
  { timeout: 12_000 },
  async () => {
    const port = await freePort();

    const child = spawn(
      process.execPath,
      ["server.js"],
      {
        cwd: __dirname,
        env: {
          ...process.env,
          PORT: String(port),
          RENDER: "true",
          RENDER_GIT_COMMIT: "0123456789abcdef0123456789abcdef01234567",
          DATABASE_URL: "",
          OPENAI_API_KEY: "",
          OPENAI_BOT_API_KEY: "",
          BOT_AI_ENABLED: "false"
        },
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", chunk => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", chunk => {
      stderr += chunk.toString();
    });

    const exitCode = await Promise.race([
      new Promise(resolve => child.once("exit", resolve)),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Le serveur Render n'a pas refusé le démarrage.")),
          7000
        )
      )
    ]);

    if (child.exitCode === null) {
      child.kill("SIGKILL");
    }

    assert.notEqual(exitCode, 0);
    assert.match(
      `${stdout}\n${stderr}`,
      /DATABASE_URL est obligatoire sur Render|Démarrage P'tit Bac refusé/
    );
  }
);
