import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

const endpoint = process.env.MCP_URL || 'https://cloneforge-mcp.vercel.app/api/mcp';
const outputDirectory = path.resolve(process.env.OUTPUT_DIR || 'cloneforge-live-test/generated');
let sessionId;
let requestId = 1;

function parseBody(text) {
  if (!text.trim()) return null;
  try { return JSON.parse(text); } catch {}
  const payloads = text.split(/\r?\n/)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trim())
    .filter(line => line && line !== '[DONE]');
  for (let index = payloads.length - 1; index >= 0; index--) {
    try { return JSON.parse(payloads[index]); } catch {}
  }
  throw new Error(`Unable to parse MCP response: ${text.slice(0, 1000)}`);
}

async function rpc(method, params, notification = false) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  const body = {
    jsonrpc: '2.0',
    method,
    ...(params === undefined ? {} : { params }),
    ...(notification ? {} : { id: requestId++ }),
  };
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  sessionId = response.headers.get('mcp-session-id') || sessionId;
  const text = await response.text();
  const parsed = parseBody(text);
  if (!response.ok || parsed?.error) {
    throw new Error(`${method} failed: HTTP ${response.status} ${JSON.stringify(parsed?.error || text.slice(0, 2000))}`);
  }
  return parsed;
}

function decodeProjectState(token) {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'cf2') throw new Error('Unexpected CloneForge projectState format');
  const compressed = Buffer.from(parts[2], 'base64url');
  return JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));
}

await rpc('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'cloneforge-macos-proof', version: '1.0.0' },
});
await rpc('notifications/initialized', {}, true);

const result = await rpc('tools/call', {
  name: 'cloneforge_start_project',
  arguments: {
    sourceUrl: 'https://apps.apple.com/us/app/pocketbot-ai/id6760196140',
    description: 'Build an original native SwiftUI iPhone and iPad product inspired by PocketBot: plain-English automations for email, calendar, posting, data movement, monitoring, schedules, and custom API workflows. Map screens, actions, data, states, permissions, monetization, acceptance criteria, create distinct branding and assets, generate a buildable repository with tests and CI, then audit it.',
    targetName: 'PocketForge',
    bundleId: 'com.nightvibes33.pocketforge',
    platform: 'native-swiftui',
    backend: 'supabase',
    minimumIos: '18.0',
    maxScreens: 16,
    visualDirection: 'Distinct dark kinetic automation workspace with original typography, iconography, color system, and interaction patterns. Do not copy PocketBot branding or assets.',
  },
});

const structured = result?.result?.structuredContent;
if (!structured?.projectState) throw new Error(`Missing portable projectState: ${JSON.stringify(result).slice(0, 2000)}`);
const state = decodeProjectState(structured.projectState);
if (!Array.isArray(state.files) || state.files.length < 20) throw new Error('Generated repository is incomplete');

await fs.rm(outputDirectory, { recursive: true, force: true });
await fs.mkdir(outputDirectory, { recursive: true });
for (const file of state.files) {
  const destination = path.join(outputDirectory, file.path);
  const relative = path.relative(outputDirectory, destination);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Unsafe generated path: ${file.path}`);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const bytes = file.encoding === 'base64' ? Buffer.from(file.content, 'base64') : Buffer.from(file.content, 'utf8');
  await fs.writeFile(destination, bytes);
}

const evidence = {
  projectId: state.projectId,
  generatedAt: new Date().toISOString(),
  source: state.input?.urls,
  screens: state.graph?.screens?.length || 0,
  nestedActions: (state.graph?.screens || []).reduce((sum, screen) => sum + (screen.actions?.length || 0), 0),
  files: state.files.length,
  audit: state.audit,
  capabilities: state.capabilities,
};
await fs.writeFile(path.join(outputDirectory, 'cloneforge', 'macos-proof-input.json'), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
