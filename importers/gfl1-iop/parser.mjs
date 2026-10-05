import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import { applyDates } from './dates.mjs';

const sections = new Map([
  ['Main Story', ['main', '主线章节']],
  ['Story Events', ['story-events', '主线活动']],
  ['Minor Events', ['minor-events', '小型活动']],
  ['Collaboration Events', ['collaboration', '联动活动']],
]);
const wholeStories = new Map([
  ['White Day 2022: Love Bakery', 'Love_Bakery'],
  ['Summer 2022: Lycan Sanctuary', 'Lycan_Sanctuary'],
  ['The Glistening Bloom (Zombie Land Saga collab)', 'The_Glistening_Bloom'],
]);
function normalizeStages(stages) {
  let chapter = null;
  return stages.map(stage => {
    const title = clean(stage.title ?? '');
    const match = title.match(/^E(\d+)-/);
    if (match) chapter = match[1];
    return { ...stage, title: title === 'DRF24' && chapter ? 'DRF24（第' + chapter + '章）' : title };
  });
}
const clean = text => text.replace(/\[edit\]/g, '').replace(/\s+/g, ' ').trim();
const hash = text => createHash('sha256').update(text).digest('hex').slice(0, 24);
const code = title => title.match(/^(?:(Normal|Emergency|Night)\s+)?((?:E)?\d+(?:-[A-Z]?\d*[A-Z]?)?)(?=[:\s]|$)/)?.slice(1).filter(Boolean).join(':') ?? null;
const groupKey = group => {
  const episode = group.title.match(/^Episode (\d+(?:\.\d+)?) - /);
  return 'iop:' + sections.get(group.section)[0] + ':' + (episode ? 'episode:' + Number(episode[1]) : hash(group.title));
};
const url = title => 'https://iopwiki.com/wiki/Story#' + encodeURIComponent(title.replaceAll(' ', '_'));

export function readHtml(html) {
  const $ = load(html);
  const body = $('.mw-parser-output').first();
  if (!body.length || /Just a moment|cf-chl-/i.test(html)) throw new Error('IOP 未返回有效剧情正文');
  body.find('.toc, .mw-editsection, script, style').remove();
  const groups = [];
  let section = null, group = null;
  body.find('h2, h3, h4').each((_, element) => {
    const heading = $(element), level = element.tagName;
    const title = clean(heading.text());
    if (level === 'h2') { section = sections.has(title) ? title : null; group = null; }
    else if (level === 'h3') {
      group = section ? { section, title, stages: [] } : null;
      if (group) groups.push(group);
    } else if (group) {
      group.stages.push({ title });
    }
  });
  for (const group of groups) group.stages = normalizeStages(group.stages);
  return groups;
}

export function parseGroups(groups, baseline = []) {
  if (!Array.isArray(groups) || !groups.length) throw new Error('剧情列表为空');
  const warnings = ['IOP 使用英文关卡名；目录涵盖国服主线结局，但不作为任何服务器的开放进度证明。', '日期使用国服章节／活动首次开放日；夜战使用独立开放日。'];
  const nodes = [], seen = new Set();
  const add = node => {
    if (seen.has(node.sourceKey)) throw new Error('重复剧情标识：' + node.title);
    seen.add(node.sourceKey); nodes.push(node);
  };
  for (const [order, rawGroup] of groups.entries()) {
    const group = { ...rawGroup, stages: Array.isArray(rawGroup.stages) ? normalizeStages(rawGroup.stages) : rawGroup.stages };
    if (!sections.has(group.section) || !group.title || !Array.isArray(group.stages)) throw new Error('剧情分类格式无效');
    if (!group.stages.length && !wholeStories.has(group.title)) { warnings.push(group.title + '：网站尚未列出关卡，暂未加入。'); continue; }
    const [storyLineId] = sections.get(group.section);
    const sourceKey = groupKey(group);
    add({ sourceKey, storyLineId, parentKey: null, title: group.title, order, releasedAt: null, sourceUrl: wholeStories.has(group.title) ? 'https://iopwiki.com/wiki/' + wholeStories.get(group.title) : url(group.title) });
    if (wholeStories.has(group.title)) continue;
    const oldGroup = baseline.find(g => groupKey(g) === sourceKey);
    const previous = oldGroup ? { ...oldGroup, stages: normalizeStages(oldGroup.stages) } : null;
    const repeated = new Set();
    for (const [stageOrder, stage] of group.stages.entries()) {
      const title = clean(stage.title ?? '');
      if (!title || repeated.has(title)) throw new Error('重复或无名称关卡：' + group.title + ' / ' + title);
      repeated.add(title);
      // Existing snapshot identities survive renaming of uniquely coded missions.
      // Repeated codes in IOP are distinct missions, so never collapse by code.
      let identityTitle = title;
      if (previous && !previous.stages.some(s => s.title === title)) {
        const identifier = code(title);
        const old = identifier && previous.stages.filter(s => code(s.title) === identifier);
        const current = identifier && group.stages.filter(s => code(s.title) === identifier);
        if (old?.length === 1 && current?.length === 1) identityTitle = old[0].title;
        else if (old?.length) throw new Error('关卡编号重名，需人工核对：' + group.title + ' / ' + title);
      }
      add({ sourceKey: sourceKey + ':stage:' + hash(identityTitle), storyLineId, parentKey: sourceKey, title, order: stageOrder, releasedAt: null, sourceUrl: url(group.title) });
    }
  }
  if (!nodes.length) throw new Error('没有可导入关卡');
  return applyDates({ apiVersion: 1, catalog: { importerId: 'gfl1-iop', game: { id: 'girls-frontline', title: '少女前线' }, storyLines: [...sections.values()].filter(([id]) => nodes.some(n => n.storyLineId === id)).map(([id, title], order) => ({ id, title, order })), nodes }, warnings });
}

export function parseLive(html, snapshot) {
  const groups = readHtml(html);
  const missing = snapshot.groups.filter(old => !groups.some(g => groupKey(g) === groupKey(old)));
  const reduced = snapshot.groups.filter(old => {
    const current = groups.find(g => groupKey(g) === groupKey(old));
    return current && current.stages.length < old.stages.length;
  });
  if (missing.length || reduced.length) throw new Error('IOP 列表缺少已知章节或关卡，停止更新，避免误归档');
  return parseGroups(groups, snapshot.groups);
}
