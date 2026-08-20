export type Endpoint = { host: string; port: number };

function validIPv4(host: string): boolean {
  const parts = host.split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function validIPv6(host: string): boolean {
  if (!host.includes(":")) return false;
  try {
    return new URL(`http://[${host}]/`).hostname.startsWith("[");
  } catch {
    return false;
  }
}

function validHostname(host: string): boolean {
  const value = host.endsWith(".") ? host.slice(0, -1) : host;
  if (!value || value.length > 253) return false;
  return value.split(".").every(
    (label) => label.length <= 63 && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label),
  );
}

export function parseEndpoint(address: string): Endpoint {
  let host: string;
  let rawPort: string;

  if (address.startsWith("[")) {
    const match = /^\[([^\]]+)\]:(\d+)$/.exec(address);
    if (!match || !validIPv6(match[1])) {
      throw new Error("endpoint must be host:port (bracket IPv6 addresses)");
    }
    [, host, rawPort] = match;
  } else {
    const separator = address.lastIndexOf(":");
    if (separator <= 0 || separator !== address.indexOf(":")) {
      throw new Error("endpoint must be host:port (bracket IPv6 addresses)");
    }
    host = address.slice(0, separator);
    rawPort = address.slice(separator + 1);
    const numeric = /^[0-9.]+$/.test(host);
    if ((numeric && !validIPv4(host)) || (!numeric && !validHostname(host))) throw new Error("invalid host");
  }

  if (!/^\d{1,5}$/.test(rawPort)) throw new Error("port must be between 1 and 65535");
  const port = Number(rawPort);
  if (port < 1 || port > 65535) throw new Error("port must be between 1 and 65535");
  return { host, port };
}
