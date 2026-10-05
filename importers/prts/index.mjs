import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePrts } from './parser.mjs';

const root = dirname(fileURLToPath(import.meta.url));

async function fetchPage(page) {
  const url = new URL('https://prts.wiki/api.php');
  url.search = new URLSearchParams({ action: 'parse', page, prop: 'text', format: 'json', formatversion: '2' }).toString();
  const response = await fetch(url, { headers: { 'User-Agent': 'StoryTracker/0.1 (local catalog importer)', Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`PRTS 请求失败：HTTP ${response.status}（${page}）`);
  const raw = await response.text();
  if (Buffer.byteLength(raw) > 10 * 1024 * 1024) throw new Error('PRTS 页面超过大小限制');
  const data = JSON.parse(raw);
  if (data.error) throw new Error(`PRTS API 错误：${data.error.info ?? data.error.code}`);
  if (data.parse?.title !== page || typeof data.parse.text !== 'string' || !data.parse.text.trim()) {
    throw new Error(`PRTS API 响应格式变化：${page}`);
  }
  return data.parse.text;
}

function htmlFromFile(text, page) {
  if (text.trimStart().startsWith('{')) {
    const data = JSON.parse(text);
    const html = typeof data.parse?.text === 'string' ? data.parse.text : data.parse?.text?.['*'];
    if (data.parse?.title !== page || typeof html !== 'string') throw new Error(`本地 API 文件无效：${page}`);
    return html;
  }
  return text;
}

try {
  const args = process.argv.slice(2);
  const allowed = new Set(['--stories', '--events', '--output']);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.has(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('参数格式：--stories 文件 --events 文件 [--output 文件]');
    options[args[i].slice(2)] = args[i + 1];
  }
  // Module-local configuration is independent of the application. It can
  // point to browser-saved HTML/API files when the Wiki is unavailable.
  let config = {};
  try { config = JSON.parse(await readFile(join(root, 'config.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const loadPage = async (page, file) => file ? htmlFromFile(await readFile(file, 'utf8'), page) : fetchPage(page);
  const stories = await loadPage('剧情一览', options.stories ?? config.stories);
  const events = await loadPage('活动一览', options.events ?? config.events);
  const output = parsePrts(stories, events);
  const json = JSON.stringify(output);
  if (options.output) await writeFile(options.output, json, 'utf8');
  else process.stdout.write(json);
} catch (error) {
  console.error(`明日方舟导入失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
