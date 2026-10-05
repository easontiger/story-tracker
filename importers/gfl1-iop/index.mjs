import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGroups, parseLive } from './parser.mjs';

const root = dirname(fileURLToPath(import.meta.url));
async function fetchStory() {
  const response = await fetch('https://iopwiki.com/api.php?action=parse&page=Story&prop=text&format=json&formatversion=2', {
    headers: { 'User-Agent': 'StoryTracker/0.1 (local catalog importer)', Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const text = await response.text();
  if (Buffer.byteLength(text) > 10 * 1024 * 1024) throw new Error('页面超过大小限制');
  return text;
}
try {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--snapshot' || arg === '--live') options[arg.slice(2)] = true;
    else if ((arg === '--html' || arg === '--output') && args[i + 1] && !args[i + 1].startsWith('--')) options[arg.slice(2)] = args[++i];
    else throw new Error('参数：--html 文件 | --snapshot | --live，另可指定 --output 文件');
  }
  if ([options.html, options.snapshot, options.live].filter(Boolean).length > 1) throw new Error('数据来源参数不能同时使用');
  const snapshot = JSON.parse(await readFile(join(root, 'story-list.json'), 'utf8'));
  let output;
  if (options.snapshot) {
    output = parseGroups(snapshot.groups);
    output.warnings.unshift('使用 ' + snapshot.checkedAt + ' 的 IOP 离线列表，未检查网站更新。');
  } else {
    let html;
    // Only transport failure may use the bundled snapshot. Invalid/partial
    // live data must fail rather than replace a newer catalog with stale data.
    try { html = options.html ? await readFile(resolve(options.html), 'utf8') : await fetchStory(); }
    catch (error) {
      if (options.live || options.html) throw error;
      output = parseGroups(snapshot.groups);
      output.warnings.unshift('IOP 自动请求失败（' + error.message + '），使用 ' + snapshot.checkedAt + ' 离线列表；不是实时更新。');
    }
    if (html !== undefined) {
      if (!options.html) {
        const data = JSON.parse(html);
        if (data.parse?.title !== 'Story' || typeof data.parse?.text !== 'string') throw new Error('API 返回无效正文');
        html = data.parse.text;
      }
      output = parseLive(html, snapshot);
    }
  }
  const json = JSON.stringify(output, null, 2);
  if (options.output) await writeFile(resolve(options.output), json + '\n', 'utf8');
  else process.stdout.write(json);
} catch (error) {
  console.error('少女前线导入失败：' + error.message);
  process.exitCode = 1;
}
