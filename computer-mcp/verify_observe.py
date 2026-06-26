#!/usr/bin/env python3
"""End-to-end verification of the observe sidecar through the REAL gateway path.

Spawns the local `computer-mcp` MCP server exactly as codex would, drives the MCP stdio handshake,
then calls `computer_observe` once and prints the vision model's description of THIS machine's screen.

Usage:
  AGENTDESK_RUNTIME_API_KEY="$(cat /path/to/dispatch_key)" python3 verify_observe.py ["a question"]

Gateway base + model default to the UAT gateway / a vision-capable model; override via env:
  ADG_GATEWAY_BASE=https://adg-uat.zhaozhunai.com/v1  ADG_VISION_MODEL=gpt-5.4-mini
"""
import json
import os
import pathlib
import select
import subprocess
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
BASE = os.environ.get("ADG_GATEWAY_BASE", "https://adg-uat.zhaozhunai.com/v1")
MODEL = os.environ.get("ADG_VISION_MODEL", "gpt-5.4-mini")
KEY = os.environ.get("AGENTDESK_RUNTIME_API_KEY", "").strip()
QUESTION = sys.argv[1] if len(sys.argv) > 1 else ""

if not KEY:
    sys.exit("set AGENTDESK_RUNTIME_API_KEY to the sk-adg_* dispatch key")

bin_path = next(
    (str(HERE / c) for c in ("target/release/computer-mcp", "target/debug/computer-mcp")
     if (HERE / c).exists()),
    None,
)
if not bin_path:
    print("building sidecar (cargo build)…", file=sys.stderr)
    subprocess.run(["cargo", "build"], cwd=HERE, check=True)
    bin_path = str(HERE / "target/debug/computer-mcp")

proc = subprocess.Popen(
    [bin_path, "--gateway-base-url", BASE, "--model", MODEL],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    env={**os.environ, "AGENTDESK_RUNTIME_API_KEY": KEY}, text=True, bufsize=1,
)


def send(obj):
    proc.stdin.write(json.dumps(obj) + "\n")
    proc.stdin.flush()


send({"jsonrpc": "2.0", "id": 1, "method": "initialize",
      "params": {"protocolVersion": "2025-06-18", "capabilities": {},
                 "clientInfo": {"name": "verify", "version": "1"}}})
send({"jsonrpc": "2.0", "method": "notifications/initialized"})
send({"jsonrpc": "2.0", "id": 2, "method": "tools/call",
      "params": {"name": "computer_observe",
                 "arguments": {"question": QUESTION} if QUESTION else {}}})

print(f"→ observing this screen via {MODEL} through {BASE} …\n", file=sys.stderr)
deadline = time.time() + 150
while time.time() < deadline:
    ready, _, _ = select.select([proc.stdout], [], [], max(0.1, deadline - time.time()))
    if not ready:
        print("timed out waiting for the tool result", file=sys.stderr)
        break
    line = proc.stdout.readline()
    if not line:
        print("sidecar exited early. stderr:", file=sys.stderr)
        print(proc.stderr.read(), file=sys.stderr)
        break
    try:
        msg = json.loads(line.strip())
    except ValueError:
        continue
    if msg.get("id") == 2:
        if msg.get("error"):
            print("tool call error:", json.dumps(msg["error"]))
            break
        res = msg.get("result") or {}
        text = "\n".join(c.get("text", "") for c in res.get("content", []) if c.get("type") == "text")
        print("=== computer_observe result" + (" (isError)" if res.get("isError") else "") + " ===")
        print(text)
        break
proc.terminate()
