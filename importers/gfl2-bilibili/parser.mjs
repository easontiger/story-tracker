import { createHash } from 'node:crypto';
const videoUrl = bvid => 'https://www.bilibili.com/video/' + bvid + '/';
function normalize(value) {
  return value.normalize('NFKC').replace(/[（(](上|中|下|初|承|转|终)[）)]/g, '·$1篇').replace(/[\s·！!]/g, '');
}
function chapterNumber(value) {
  if (/^[\d.]/.test(value)) return Number(value.split('及')[0]);
  const digits = '零一二三四五六七八九';
  if (value.includes('十')) {
    const [tens, units] = value.split('十');
    return (tens ? digits.indexOf(tens) : 1) * 10 + (units ? digits.indexOf(units) : 0);
  }
  return digits.indexOf(value);
}
function storyName(title) {
  const name = title.match(/【([^】]+)】/)?.[1]?.replace(/\/(?:4K|1080P|高清).*$/i, '').trim();
  if (!name) throw new Error('视频标题无法解析：' + title);
  return name;
}
export function beijingDay(timestamp) {
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) throw new Error('活动开始时间无效');
  return new Date((timestamp + 8 * 3600) * 1000).toISOString().slice(0, 10);
}
export function storyPages(video) {
  const coded = video.pages.filter(page => typeof page.part === 'string' && /^(?:[A-Z]{1,4}-)?\d{1,3}-\d{1,3}(?:-\d{1,3})?(?:\s|$)/i.test(page.part.trim()));
  return video.pages.filter(page => {
    if (typeof page.part !== 'string' || !Number.isSafeInteger(page.cid) || page.cid <= 0 || !Number.isSafeInteger(page.page) || page.page < 1) throw new Error('分 P 目录格式无效：' + video.title);
    if (/改版剧情/.test(video.title) && /旧版/.test(page.part)) return false;
    return !(coded.length && /一镜到底|合集|完整版|全流程|完整流程|完整剧情/.test(page.part));
  });
}
export function isCodedPart(page) {
  return /^(?:[A-Z]{1,4}-)?\d{1,3}-\d{1,3}(?:-\d{1,3})?(?:\s|$)/i.test(page.part.trim());
}
function chapterStories(page) {
  if (page.chapters !== undefined && !Array.isArray(page.chapters)) throw new Error('视频章节格式无效');
  const stories = new Map();
  for (const point of page.chapters ?? []) {
    if (point.type !== 2) continue;
    if (typeof point.content !== 'string' || !point.content.trim() || !Number.isFinite(point.from) || point.from < 0 || !Number.isFinite(point.to) || point.to < point.from) throw new Error('视频章节时间或标题无效');
    const title = point.content.trim();
    const matches = [...title.matchAll(/(?:^|[、，,；;]\s*)((?:[A-Z]{1,4}-)?\d{1,3}-\d{1,3}(?:-\d{1,3})?)(?=\s)/gi)];
    const pieces = matches.length ? matches.map((match, index) => ({
      title: title.slice(match.index, matches[index + 1]?.index ?? title.length).replace(/^[、，,；;]\s*/, '').trim(),
      key: 'stage:' + match[1].toUpperCase(),
    })) : [{ title, key: 'chapter:' + createHash('sha256').update(title).digest('hex').slice(0, 24) }];
    for (const piece of pieces) {
      // Repeated pre/post-battle segments remain one watchable stage.
      if (!stories.has(piece.key)) stories.set(piece.key, { ...piece, from: Math.floor(point.from) });
    }
  }
  return [...stories.values()].sort((a, b) => a.from - b.from);
}
export function eventDates(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('IOP 日期表为空');
  const dates = new Map();
  for (const row of rows) {
    if (row.server !== 'CN') continue;
    if (typeof row.title !== 'string' || !row.title.trim() || typeof row.startUtc !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(row.startUtc)
      || !Number.isFinite(Date.parse(row.startUtc)) || new Date(row.startUtc).toISOString() !== row.startUtc.replace('Z', '.000Z')) throw new Error('IOP 国服开始时间无效');
    const key = normalize(row.title);
    const day = beijingDay(Date.parse(row.startUtc) / 1000);
    if (!dates.has(key) || day < dates.get(key)) dates.set(key, day); // Keep first run, not reruns.
  }
  if (!dates.size) throw new Error('IOP 日期表缺少国服活动');
  return dates;
}
function matchEventDate(dates, name) {
  const key = normalize(name);
  const base = key.replace(/(?:上|中|下|初|承|转|终)篇$/, '');
  return dates.get(key) ?? dates.get(base) ?? (key === base ? dates.get(key + '上篇') ?? dates.get(key + '初篇') : null) ?? null;
}
function chapterDateMap(rows) {
  if (!Array.isArray(rows)) throw new Error('章节日期表无效');
  const dates = new Map();
  for (const row of rows) {
    if (!Number.isSafeInteger(row.chapter) || row.chapter < 1 || dates.has(row.chapter)
      || typeof row.releasedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.releasedAt)
      || !Number.isFinite(Date.parse(row.releasedAt)) || new Date(row.releasedAt).toISOString().slice(0,10) !== row.releasedAt
      || (row.note !== undefined && (typeof row.note !== 'string' || row.note.length > 1000))) throw new Error('章节日期无效或章号重复');
    dates.set(row.chapter, row);
  }
  return dates;
}
function chapterDate(title, lineId, dates) {
  const chapter = title.match(/^第([\d.]+(?:及[\d.]+)?|[一二三四五六七八九十]+)章/);
  return lineId === 'main' && chapter ? dates.get(chapterNumber(chapter[1])) : undefined;
}
export function updateEventDates(output, rows, chapterDates = []) {
  const dates = eventDates(rows);
  const overrides = chapterDateMap(chapterDates);
  const notes = [];
  const aliases = { '于灰败的羽翼中': '异乡乐徽', '苦涩荆棘与矢车菊': '方糖特调沙龙' };
  const groupDates = new Map();
  for (const node of output.catalog.nodes.filter(node => node.parentKey === null)) {
    const name = node.title.replace(/^第([\d.]+(?:及[\d.]+)?|[一二三四五六七八九十]+)章\s*/, '');
    const override = chapterDate(node.title, node.storyLineId, overrides);
    groupDates.set(node.sourceKey, override?.releasedAt ?? matchEventDate(dates, aliases[name] ?? name));
    if (override?.note) notes.push(override.note);
  }
  const warnings = output.warnings.filter(item => !/PV|未匹配到 IOP/.test(item));
  for (const node of output.catalog.nodes) {
    const releasedAt = groupDates.get(node.parentKey ?? node.sourceKey) ?? null;
    node.releasedAt = releasedAt;
    if (node.parentKey === null && !releasedAt) warnings.push('未匹配到 IOP 国服活动日期，留空：' + node.title);
  }
  output.warnings = [...new Set([...warnings, ...notes])];
  return output;
}
export function parseGfl2({ main, events, eventDates: rows, chapterDates = [] }) {
  if (![main, events].every(items => Array.isArray(items) && items.length)) throw new Error('主线或活动列表为空');
  const warnings = [];
  const dates = eventDates(rows);
  const overrides = chapterDateMap(chapterDates);
  const replacements = new Map();
  for (const video of main) {
    if (!/改版剧情/.test(video.title)) continue;
    const original = video.title.match(/原【([^】]+)】/)?.[1];
    if (!original) continue;
    const key = normalize(original);
    if (replacements.has(key)) throw new Error('同一原版存在多个改版，已停止覆盖：' + original);
    replacements.set(key, { original, video });
  }
  const nodes = [];
  const seenVideos = new Set();
  const seenKeys = new Set();
  function add(node) {
    if (seenKeys.has(node.sourceKey)) throw new Error('剧情标识重复：' + node.sourceKey);
    seenKeys.add(node.sourceKey);
    nodes.push(node);
  }
  for (const [lineId, videos] of [['main', main], ['events', events]]) {
    const groups = videos.filter(video => {
      if (lineId !== 'events') return true;
      const replacement = replacements.get(normalize(storyName(video.title)));
      if (!replacement) return true;
      warnings.push('已用改版覆盖原版：' + replacement.original + ' → ' + storyName(replacement.video.title) + '；原版观看记录保留');
      return false;
    }).map(video => {
      if (!/^BV[0-9A-Za-z]{10}$/.test(video.bvid) || typeof video.title !== 'string' || !Array.isArray(video.pages) || !video.pages.length) throw new Error('视频目录格式无效');
      const title = storyName(video.title);
      const chapter = title.match(/^第([\d.]+(?:及[\d.]+)?|[一二三四五六七八九十]+)章\s*/);
      const name = chapter ? title.slice(chapter[0].length) : title;
      const original = /改版剧情/.test(video.title) ? video.title.match(/原【([^】]+)】/)?.[1] : null;
      const override = chapterDate(title, lineId, overrides);
      const releasedAt = override?.releasedAt ?? matchEventDate(dates, original ?? name);
      if (override?.note) warnings.push(override.note);
      return { video, title, releasedAt, chapter: chapter ? chapterNumber(chapter[1]) : 1000 };
    }).sort((a, b) => lineId === 'main' ? a.chapter - b.chapter || a.title.localeCompare(b.title, 'zh-CN')
      : (a.releasedAt ?? '9999').localeCompare(b.releasedAt ?? '9999') || a.title.localeCompare(b.title, 'zh-CN'));
    groups.forEach(({ video, title, releasedAt }, order) => {
      if (seenVideos.has(video.bvid)) {
        warnings.push('重复视频已跳过：' + title);
        return;
      }
      seenVideos.add(video.bvid);
      if (!releasedAt) warnings.push('未匹配到 IOP 国服活动日期，留空：' + title);
      if (/改版剧情/.test(video.title) && !/原【[^】]+】/.test(video.title)) warnings.push('改版视频未声明原版名称，未覆盖其他目录：' + title);
      const pages = storyPages(video);
      if (!pages.length) throw new Error('没有可导入的剧情分 P：' + title);
      const parentKey = 'video:' + video.bvid;
      add({ sourceKey: parentKey, storyLineId: lineId, parentKey: null, title, order, releasedAt, sourceUrl: videoUrl(video.bvid) });
      pages.forEach((page, index) => {
        const chapters = isCodedPart(page) ? [] : chapterStories(page);
        if (chapters.length) {
          for (const chapter of chapters) add({ sourceKey: parentKey + ':cid:' + page.cid + ':' + chapter.key, storyLineId: lineId, parentKey,
            title: chapter.title, order: index * 10000 + chapters.indexOf(chapter), releasedAt,
            sourceUrl: videoUrl(video.bvid) + '?p=' + page.page + '&t=' + chapter.from });
          return;
        }
        let leafTitle = page.part.trim();
        const whole = pages.length === 1 && !isCodedPart(page);
        if (whole) {
          leafTitle = '整章剧情';
          warnings.push('该视频没有细分剧情目录，暂按整章记录：' + title);
        }
        add({ sourceKey: parentKey + ':cid:' + page.cid, storyLineId: lineId, parentKey, title: leafTitle, order: index * 10000, releasedAt,
          sourceUrl: videoUrl(video.bvid) + '?p=' + page.page });
      });
    });
  }
  return { apiVersion: 1, catalog: { importerId: 'gfl2-bilibili', game: { id: 'girls-frontline-2', title: '少女前线2：追放' },
    storyLines: [{ id: 'main', title: '主线剧情', order: 0 }, { id: 'events', title: '活动剧情', order: 1 }], nodes }, warnings: [...new Set(warnings)] };
}
