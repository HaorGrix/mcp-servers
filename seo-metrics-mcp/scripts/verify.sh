#!/usr/bin/env bash
# Build, typecheck, and confirm the server starts and enumerates its tools.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> typecheck"
npx tsc --noEmit

echo "==> build"
npm run build >/dev/null

echo "==> MCP handshake"
node - <<'NODE'
import { spawn } from 'node:child_process';
const p = spawn('node', ['dist/index.js'], { stdio: ['pipe', 'pipe', 'inherit'] });
let buf = '';
const pending = new Map();
let id = 0;
p.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    try { const m = JSON.parse(line); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } catch {}
  }
});
const send = (method, params) => new Promise((res) => {
  const n = ++id; pending.set(n, res);
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
});
await send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'verify', version: '1' } });
p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
const tools = await send('tools/list', {});
const count = tools.result.tools.length;
p.kill();
if (count < 17) { console.error(`expected at least 17 tools, got ${count}`); process.exit(1); }
console.log(`ok — ${count} tools registered`);
NODE

echo "==> all checks passed"
