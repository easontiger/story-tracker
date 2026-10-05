import { writeFile, rename, rm, readFile } from 'node:fs/promises';
import { parseGfl2, storyPages, isCodedPart } from './parser.mjs';

import { supplementMain } from './supplement.mjs';
import { splitResidentStages, splitMergedStories } from './corrections.mjs';

import { applyReferenceCorrections } from './reference.mjs';

const API = 'https://api.bilibili.com';
async function request(path, parameters) {
  const url = new URL(path, API);
  url.search = new URLSearchParams(parameters).toString();
  const response = await fetch(url, { headers: { 'User-Agent': 'StoryTracker/0.1', Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('B站请求失败：HTTP ' + response.status);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4 * 1024 * 1024) throw new Error('B站响应超过大小限制');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (result.code !== 0 || !result.data) throw new Error('B站接口错误：' + (result.message ?? result.code));
  return result.data;
}
async function collection(bvid, replaced = new Set()) {
  const seed = await request('/x/web-interface/view', { bvid });
  const sections = seed.ugc_season?.sections;
  if (!Array.isArray(sections)) throw new Error('剧情视频未返回合集目录');
  const entries = sections.flatMap(section => section.episodes ?? []);
  if (!entries.length || entries.length !== seed.ugc_season.ep_count || entries.length > 300) throw new Error('剧情合集目录不完整或过大');
  const output = new Array(entries.length);
  let cursor = 0;
  let failure;
  const workers = Array.from({ length: Math.min(3, entries.length) }, async () => {
    while (!failure && cursor < entries.length) {
      const index = cursor++;
      const entry = entries[index];
      try {
        const eventName = entry.title.match(/【([^】]+)】/)?.[1]?.replace(/\/4K.*$/i, '').replace(/[\s·！!]/g, '');
        if (replaced.has(eventName)) {
          output[index] = { bvid: entry.bvid, title: entry.title, pages: [] };
          continue;
        }
    const video = entry.bvid === seed.bvid ? seed : await request('/x/web-interface/view', { bvid: entry.bvid });
    if (video.bvid !== entry.bvid || video.owner?.mid !== 193691415 || !video.title?.includes('少前2') || video.videos !== video.pages?.length) throw new Error('剧情视频目录格式变化');
    for (const page of storyPages(video)) {
      if (isCodedPart(page)) continue;
      const player = await request('/x/player/v2', { aid: String(video.aid), cid: String(page.cid) });
      if (player.aid !== video.aid || player.cid !== page.cid) throw new Error('视频章节响应不匹配');
      page.chapters = player.view_points ?? [];
      if (!Array.isArray(page.chapters)) throw new Error('视频章节格式变化');
    }
    output[index] = { bvid: video.bvid, title: video.title, pages: video.pages };
    await new Promise(resolve => setTimeout(resolve, 150));
      } catch (error) { failure ??= error; }
    }
  });
  await Promise.all(workers);
  if (failure) throw failure;
  return output;
}
async function liveData() {
  const main = await collection('BV1unaj61Ec4');
  const replaced = new Set(main.filter(video => /改版剧情/.test(video.title))
    .map(video => video.title.match(/原【([^】]+)】/)?.[1]?.replace(/[\s·！!]/g, '')).filter(Boolean));
  return {
    main,
    events: await collection('BV1Hatg6uENF', replaced),
    eventDates: JSON.parse(await readFile(new URL('./events.json', import.meta.url), 'utf8')).events,
    chapterDates: JSON.parse(await readFile(new URL('./chapters.json', import.meta.url), 'utf8')).chapters,
  };
}
async function main() {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--output', '--input'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('参数格式：[--input 本地数据.json] [--output 文件.json]');
    options[args[i].slice(2)] = args[i + 1];
  }
  const data = options.input ? JSON.parse(await readFile(options.input, 'utf8')) : await liveData();
  const output = applyReferenceCorrections(splitMergedStories(splitResidentStages(supplementMain(parseGfl2(data)))));
  const json = JSON.stringify(output, null, 2) + '\n';
  if (!options.output) process.stdout.write(json);
  else {
    const temporary = options.output + '.tmp-' + process.pid;
    try { await writeFile(temporary, json, 'utf8'); await rename(temporary, options.output); }
    finally { await rm(temporary, { force: true }); }
    console.error('已导出 ' + output.catalog.nodes.length + ' 个节点，' + output.warnings.length + ' 项提示');
  }
}
main().catch(error => { console.error('少前2导入失败：' + error.message); process.exitCode = 1; });
