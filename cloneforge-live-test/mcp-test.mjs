import fs from 'node:fs/promises';

const endpoint = process.env.MCP_URL || 'https://cloneforge-mcp.vercel.app/api/mcp';
const pocketBotUrl = 'https://apps.apple.com/us/app/pocketbot-ai/id6760196140';
const brief = 'Build an original native SwiftUI iPhone and iPad product inspired by PocketBot: plain-English automations for email, calendar, posting, data movement, monitoring, schedules, and custom API workflows. Map screens, actions, data, states, permissions, monetization, acceptance criteria, create distinct branding and assets, generate a buildable repository with tests and CI, then audit it.';
let sessionId;
let requestId = 1;

await fs.mkdir('cloneforge-live-test/results', { recursive: true });

function parseMcpBody(text) {
  if (!text.trim()) return null;
  try { return JSON.parse(text); } catch {}
  const payloads = text.split(/\r?\n/)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trim())
    .filter(Boolean)
    .filter(line => line !== '[DONE]');
  for (let i = payloads.length - 1; i >= 0; i--) {
    try { return JSON.parse(payloads[i]); } catch {}
  }
  return { raw: text };
}

async function postRpc(method, params, notification = false) {
  const id = notification ? undefined : requestId++;
  const payload = { jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }), ...(id === undefined ? {} : { id }) };
  const headers = {
    'content-type': 'application/json',
    'accept': 'application/json, text/event-stream',
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(payload), redirect: 'follow' });
  sessionId = response.headers.get('mcp-session-id') || sessionId;
  const text = await response.text();
  const parsed = parseMcpBody(text);
  if (!response.ok) {
    throw new Error(`${method} HTTP ${response.status}: ${text.slice(0, 2000)}`);
  }
  if (parsed?.error) {
    throw new Error(`${method} RPC error: ${JSON.stringify(parsed.error)}`);
  }
  return { status: response.status, contentType: response.headers.get('content-type'), sessionId, parsed, raw: text };
}

function primitiveValue(name, schema, mode = 'url') {
  if (schema?.enum?.length) return schema.enum[0];
  const lower = name.toLowerCase();
  const type = Array.isArray(schema?.type) ? schema.type.find(v => v !== 'null') : schema?.type;
  if (type === 'boolean') return true;
  if (type === 'integer' || type === 'number') return 1;
  if (type === 'array') {
    const item = schema?.items || { type: 'string' };
    if (item.type === 'object' || item.properties) return [buildObject(item, mode)];
    return [primitiveValue(name.replace(/s$/, ''), item, mode)];
  }
  if (type === 'object' || schema?.properties) return buildObject(schema, mode);
  if (lower.includes('url') || lower.includes('link') || lower === 'source') return mode === 'url' ? pocketBotUrl : brief;
  if (lower.includes('description') || lower.includes('brief') || lower.includes('prompt') || lower.includes('context')) return brief;
  if (lower.includes('target') || lower.includes('platform')) return 'Native SwiftUI iPhone and iPad application';
  if (lower.includes('project') || lower.includes('appname') || lower === 'name' || lower.includes('title')) return 'PocketForge';
  if (lower.includes('type') || lower.includes('kind')) return mode === 'url' ? 'app_store' : 'description';
  if (lower.includes('content') || lower.includes('text') || lower.includes('value')) return mode === 'url' ? pocketBotUrl : brief;
  if (lower.includes('id')) return 'pocketforge-live-test';
  return mode === 'url' ? brief : 'PocketForge';
}

function buildObject(schema, mode = 'url') {
  const properties = schema?.properties || {};
  const required = new Set(schema?.required || []);
  const result = {};
  for (const [name, propSchema] of Object.entries(properties)) {
    const lower = name.toLowerCase();
    const useful = required.has(name)
      || lower.includes('url') || lower.includes('source') || lower.includes('description')
      || lower.includes('brief') || lower.includes('prompt') || lower.includes('target')
      || lower.includes('platform') || lower.includes('project') || lower.includes('name')
      || lower.includes('original') || lower.includes('capture') || lower.includes('audit');
    if (!useful) continue;
    if (mode === 'description' && (lower.includes('url') || lower === 'link')) continue;
    result[name] = primitiveValue(name, propSchema, mode);
  }
  for (const name of required) {
    if (!(name in result)) result[name] = primitiveValue(name, properties[name] || {}, mode);
  }
  return result;
}

function toolArgs(tool, mode = 'url', projectId) {
  const schema = tool.inputSchema || { type: 'object', properties: {} };
  const args = buildObject(schema, mode);
  const props = schema.properties || {};
  if (projectId) {
    for (const name of Object.keys(props)) {
      if (name.toLowerCase().includes('project') && name.toLowerCase().includes('id')) args[name] = projectId;
      else if (name.toLowerCase() === 'id') args[name] = projectId;
    }
  }
  return args;
}

function findProjectId(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return undefined;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (/project.?id/i.test(key) && typeof child === 'string') return child;
    const nested = findProjectId(child, seen);
    if (nested) return nested;
    if (typeof child === 'string') {
      try {
        const parsed = JSON.parse(child);
        const fromText = findProjectId(parsed, seen);
        if (fromText) return fromText;
      } catch {}
      const match = child.match(/project(?:_|\s|-)?id["'\s:=]+([A-Za-z0-9_-]{6,})/i);
      if (match) return match[1];
    }
  }
}

const report = { endpoint, checks: [], calls: {} };
function check(name, ok, detail) {
  report.checks.push({ name, ok: Boolean(ok), detail });
  if (!ok) process.exitCode = 1;
}

try {
  const init = await postRpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'cloneforge-live-verifier', version: '1.0.0' },
  });
  report.calls.initialize = init.parsed;
  check('initialize', Boolean(init.parsed?.result), JSON.stringify(init.parsed).slice(0, 800));
  await postRpc('notifications/initialized', {}, true);

  const listed = await postRpc('tools/list', {});
  report.calls.toolsList = listed.parsed;
  const tools = listed.parsed?.result?.tools || [];
  const names = tools.map(t => t.name);
  const expected = [
    'cloneforge_start_project', 'cloneforge_capture_sources', 'cloneforge_get_project',
    'cloneforge_export_project', 'cloneforge_audit_project', 'cloneforge_publish_github',
    'cloneforge_check_build'
  ];
  check('seven-tools-discovered', expected.every(name => names.includes(name)), names.join(', '));

  const startTool = tools.find(t => t.name === 'cloneforge_start_project');
  check('start-project-schema-present', Boolean(startTool?.inputSchema), JSON.stringify(startTool?.inputSchema || {}).slice(0, 1500));

  const urlArgs = toolArgs(startTool, 'url');
  report.urlArgs = urlArgs;
  const started = await postRpc('tools/call', { name: startTool.name, arguments: urlArgs });
  report.calls.startUrl = started.parsed;
  const startText = JSON.stringify(started.parsed);
  check('pocketbot-url-call', !/invalid arguments|validation error/i.test(startText) && Boolean(started.parsed?.result), startText.slice(0, 1600));
  check('pocketbot-evidence', /PocketBot|6760196140|apps\.apple\.com/i.test(startText), startText.slice(0, 1600));

  const projectId = findProjectId(started.parsed);
  report.projectId = projectId;
  check('project-id-returned', Boolean(projectId), projectId || 'No project id found');

  const descriptionArgs = toolArgs(startTool, 'description');
  report.descriptionArgs = descriptionArgs;
  const described = await postRpc('tools/call', { name: startTool.name, arguments: descriptionArgs });
  report.calls.startDescription = described.parsed;
  const descriptionText = JSON.stringify(described.parsed);
  check('description-only-call', !/invalid arguments|validation error/i.test(descriptionText) && Boolean(described.parsed?.result), descriptionText.slice(0, 1600));

  for (const toolName of ['cloneforge_get_project', 'cloneforge_audit_project']) {
    const tool = tools.find(t => t.name === toolName);
    if (!tool || !projectId) continue;
    const args = toolArgs(tool, 'url', projectId);
    const called = await postRpc('tools/call', { name: tool.name, arguments: args });
    report.calls[toolName] = called.parsed;
    const text = JSON.stringify(called.parsed);
    check(toolName, Boolean(called.parsed?.result) && !/not found|invalid arguments|validation error/i.test(text), text.slice(0, 1600));
  }

  const combined = JSON.stringify(report.calls);
  check('generated-artifacts-reported', /repository|swiftui|xcodegen|backend|acceptance|screen/i.test(combined), combined.slice(0, 1800));
  check('proof-or-audit-reported', /audit|gate|placeholder|dead.?control|secret.?scan|passed/i.test(combined), combined.slice(0, 1800));
} catch (error) {
  report.fatal = String(error?.stack || error);
  check('fatal-error', false, report.fatal);
}

report.ok = report.checks.every(c => c.ok);
await fs.writeFile('cloneforge-live-test/results/report.json', JSON.stringify(report, null, 2));
await fs.writeFile('cloneforge-live-test/results/tools.json', JSON.stringify(report.calls.toolsList || {}, null, 2));
await fs.writeFile('cloneforge-live-test/results/start-url.json', JSON.stringify(report.calls.startUrl || {}, null, 2));
await fs.writeFile('cloneforge-live-test/results/start-description.json', JSON.stringify(report.calls.startDescription || {}, null, 2));
console.log(JSON.stringify({ ok: report.ok, checks: report.checks, projectId: report.projectId }, null, 2));
if (!report.ok) process.exitCode = 1;
