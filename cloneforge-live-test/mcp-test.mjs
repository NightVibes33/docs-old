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
  for (let index = payloads.length - 1; index >= 0; index--) {
    try { return JSON.parse(payloads[index]); } catch {}
  }
  return { raw: text };
}

async function postRpc(method, params, notification = false) {
  const id = notification ? undefined : requestId++;
  const payload = {
    jsonrpc: '2.0',
    method,
    ...(params === undefined ? {} : { params }),
    ...(id === undefined ? {} : { id }),
  };
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    redirect: 'follow',
  });
  sessionId = response.headers.get('mcp-session-id') || sessionId;
  const raw = await response.text();
  const parsed = parseMcpBody(raw);
  if (!response.ok) throw new Error(`${method} HTTP ${response.status}: ${raw.slice(0, 2000)}`);
  if (parsed?.error) throw new Error(`${method} RPC error: ${JSON.stringify(parsed.error)}`);
  return { status: response.status, parsed, raw };
}

const report = { endpoint, checks: [], calls: {} };
function check(name, ok, detail) {
  report.checks.push({ name, ok: Boolean(ok), detail });
  if (!ok) process.exitCode = 1;
}

function resultText(call) {
  return JSON.stringify(call?.parsed || call || {});
}

function structured(call) {
  return call?.parsed?.result?.structuredContent || {};
}

function toolByName(tools, name) {
  const tool = tools.find(item => item.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

function stateArgs(tool, projectState) {
  const properties = tool.inputSchema?.properties || {};
  const args = {};
  if ('projectState' in properties) args.projectState = projectState;
  if ('project_state' in properties) args.project_state = projectState;
  if ('state' in properties) args.state = projectState;
  return args;
}

try {
  const init = await postRpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'cloneforge-live-verifier', version: '2.0.0' },
  });
  report.calls.initialize = init.parsed;
  check('initialize', Boolean(init.parsed?.result), resultText(init).slice(0, 1000));
  await postRpc('notifications/initialized', {}, true);

  const listed = await postRpc('tools/list', {});
  report.calls.toolsList = listed.parsed;
  const tools = listed.parsed?.result?.tools || [];
  const names = tools.map(tool => tool.name);
  const expected = [
    'cloneforge_start_project',
    'cloneforge_capture_sources',
    'cloneforge_get_project',
    'cloneforge_export_project',
    'cloneforge_audit_project',
    'cloneforge_publish_github',
    'cloneforge_check_build',
  ];
  check('seven-tools-discovered', expected.every(name => names.includes(name)), names.join(', '));

  const startTool = toolByName(tools, 'cloneforge_start_project');
  check('start-project-schema-present', Boolean(startTool.inputSchema), JSON.stringify(startTool.inputSchema).slice(0, 1800));

  const urlArgs = {
    sourceUrl: pocketBotUrl,
    description: brief,
    targetName: 'PocketForge',
    bundleId: 'com.nightvibes33.pocketforge',
    platform: 'native-swiftui',
    backend: 'supabase',
    minimumIos: '18.0',
    maxScreens: 16,
    visualDirection: 'Distinct dark kinetic automation workspace with original typography, iconography, color system, and interaction patterns. Do not copy PocketBot branding or assets.',
  };
  report.urlArgs = urlArgs;
  const started = await postRpc('tools/call', { name: startTool.name, arguments: urlArgs });
  report.calls.startUrl = started.parsed;
  const startText = resultText(started);
  const startStructured = structured(started);
  check('pocketbot-url-call', Boolean(started.parsed?.result) && !/invalid arguments|validation error/i.test(startText), startText.slice(0, 1800));
  check('pocketbot-evidence', /PocketBot|6760196140|apps\.apple\.com/i.test(startText), startText.slice(0, 1800));
  check('no-fake-video-input', !/ffmpeg ENOENT|spawn .*ffmpeg/i.test(startText), startStructured.currentIssue || 'No ffmpeg issue');

  const projectId = startStructured.projectId;
  const projectState = startStructured.projectState;
  report.projectId = projectId;
  check('project-id-returned', typeof projectId === 'string' && projectId.length > 6, projectId || 'missing');
  check('portable-project-state-returned', typeof projectState === 'string' && projectState.startsWith('cf2.'), projectState ? `${projectState.slice(0, 36)}… (${projectState.length} chars)` : 'missing');

  const graph = startStructured.graph || {};
  const fileManifest = startStructured.fileManifest || [];
  const audit = startStructured.audit || {};
  check('product-graph-complete', Array.isArray(graph.screens) && graph.screens.length >= 4 && Array.isArray(graph.actions) && graph.actions.length >= 4, `${graph.screens?.length || 0} screens, ${graph.actions?.length || 0} actions`);
  check('repository-generated', Array.isArray(fileManifest) && fileManifest.length >= 20, `${fileManifest.length || 0} files`);
  check('static-release-gates', Array.isArray(audit.gates) && audit.gates.filter(gate => gate.status === 'pass').length >= 8, JSON.stringify(audit.gates || []).slice(0, 2400));
  check('no-placeholders-dead-controls-or-secrets', audit.placeholderCount === 0 && audit.deadControlCount === 0 && audit.secretFindingCount === 0, JSON.stringify({ placeholderCount: audit.placeholderCount, deadControlCount: audit.deadControlCount, secretFindingCount: audit.secretFindingCount }));

  const descriptionArgs = {
    description: brief,
    targetName: 'PocketForge Description Build',
    bundleId: 'com.nightvibes33.pocketforge.description',
    platform: 'native-swiftui',
    backend: 'supabase',
    minimumIos: '18.0',
    maxScreens: 16,
  };
  report.descriptionArgs = descriptionArgs;
  const described = await postRpc('tools/call', { name: startTool.name, arguments: descriptionArgs });
  report.calls.startDescription = described.parsed;
  const descriptionText = resultText(described);
  check('description-only-call', Boolean(described.parsed?.result) && !/invalid arguments|validation error/i.test(descriptionText), descriptionText.slice(0, 1800));

  for (const toolName of ['cloneforge_get_project', 'cloneforge_audit_project', 'cloneforge_export_project']) {
    const tool = toolByName(tools, toolName);
    const args = stateArgs(tool, projectState);
    report[`${toolName}Args`] = Object.fromEntries(Object.entries(args).map(([key, value]) => [key, typeof value === 'string' ? `${value.slice(0, 24)}…` : value]));
    const called = await postRpc('tools/call', { name: tool.name, arguments: args });
    report.calls[toolName] = called.parsed;
    const text = resultText(called);
    check(toolName, Boolean(called.parsed?.result) && !/invalid arguments|validation error|project not found/i.test(text), text.slice(0, 1800));
  }

  const auditCall = report.calls.cloneforge_audit_project;
  const auditText = JSON.stringify(auditCall || {});
  check('follow-up-audit-evidence', /placeholder|dead.?control|secret|release|gate|score/i.test(auditText), auditText.slice(0, 1800));

  const exportCall = report.calls.cloneforge_export_project;
  const exportText = JSON.stringify(exportCall || {});
  check('repository-export-returned', /zip|archive|base64|download|file/i.test(exportText), exportText.slice(0, 1800));
} catch (error) {
  report.fatal = String(error?.stack || error);
  check('fatal-error', false, report.fatal);
}

report.ok = report.checks.every(checkResult => checkResult.ok);
await fs.writeFile('cloneforge-live-test/results/report.json', JSON.stringify(report, null, 2));
await fs.writeFile('cloneforge-live-test/results/tools.json', JSON.stringify(report.calls.toolsList || {}, null, 2));
await fs.writeFile('cloneforge-live-test/results/start-url.json', JSON.stringify(report.calls.startUrl || {}, null, 2));
await fs.writeFile('cloneforge-live-test/results/start-description.json', JSON.stringify(report.calls.startDescription || {}, null, 2));
await fs.writeFile('cloneforge-live-test/results/get-project.json', JSON.stringify(report.calls.cloneforge_get_project || {}, null, 2));
await fs.writeFile('cloneforge-live-test/results/audit-project.json', JSON.stringify(report.calls.cloneforge_audit_project || {}, null, 2));
await fs.writeFile('cloneforge-live-test/results/export-project.json', JSON.stringify(report.calls.cloneforge_export_project || {}, null, 2));
console.log(JSON.stringify({ ok: report.ok, checks: report.checks, projectId: report.projectId }, null, 2));
if (!report.ok) process.exitCode = 1;
