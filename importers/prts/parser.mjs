import { load } from 'cheerio';

export const STORY_URL = 'https://prts.wiki/w/剧情一览';
export const EVENT_URL = 'https://prts.wiki/w/活动一览';
const clean = value => value.replace(/\s+/gu, ' ').trim();
const nameKey = value => clean(value).replace(/\s/gu, '').normalize('NFC');

function pageLink(href) {
  const url = new URL(href, 'https://prts.wiki');
  if (url.origin !== 'https://prts.wiki' || !url.pathname.startsWith('/w/') || url.search) {
    throw new Error(`不支持的剧情页面链接：${href}`);
  }
  const page = decodeURIComponent(url.pathname.slice(3)).replaceAll('_', ' ').normalize('NFC');
  if (!page || page.startsWith('分类:') || page.startsWith('文件:')) throw new Error(`剧情链接无效：${href}`);
  return { url: url.href, page, fragment: decodeURIComponent(url.hash) };
}

// Stage codes and BEG/END/NBT suffixes identify segments independently of
// their display titles, chapter membership, and release ordering.
export function storyIdentity(href) {
  const link = pageLink(href);
  const [base, ...suffix] = link.page.split('/');
  const code = base.match(/^([A-Z0-9]+(?:-[A-Z0-9]+)*)(?:\s|$)/u)?.[1];
  const identity = code && /[0-9-]/u.test(code) ? code : base;
  return `prts:story:${[identity, ...suffix].join('/')}${link.fragment}`;
}

function releaseDate(text) {
  const match = clean(text).match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/u);
  if (!match) throw new Error(`活动时间格式变化：${clean(text)}`);
  const [, year, month, day, hour, minute] = match;
  const date = `${year}-${month}-${day}T${hour}:${minute}:00+08:00`;
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) throw new Error(`活动日期无效：${text}`);
  // Check calendar components without accepting JS date rollover.
  const calendar = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (calendar.getUTCFullYear() !== Number(year) || calendar.getUTCMonth() + 1 !== Number(month)
    || calendar.getUTCDate() !== Number(day) || Number(hour) > 23 || Number(minute) > 59) {
    throw new Error(`活动日期无效：${text}`);
  }
  return date.slice(0, 10);
}

export function parseEvents(html) {
  const $ = load(html);
  const dates = new Map();
  let tableCount = 0;
  let rowCount = 0;
  $('table.wikitable').each((_, table) => {
    const rows = $(table).find('> tbody > tr');
    const headings = rows.first().children('th').map((_, cell) => clean($(cell).text())).get();
    if (headings[0] !== '活动开始时间' || headings[1] !== '活动页面') return;
    tableCount++;
    rows.slice(1).each((_, row) => {
      const cells = $(row).children('td');
      if (cells.length !== 4) throw new Error('活动表列数变化，已停止导入');
      const date = releaseDate(cells.eq(0).text());
      const links = cells.eq(1).find('a[href]');
      if (links.length !== 1) throw new Error('活动名称无法可靠匹配，已停止导入');
      const label = clean(links.first().text());
      const link = pageLink(links.first().attr('href'));
      rowCount++;
      if (label.includes('复刻') || clean(cells.eq(2).text()).includes('复刻')) return;
      // Match both the visible event name and its canonical Wiki page name.
      for (const name of new Set([nameKey(label), nameKey(link.page)])) {
        const previous = dates.get(name);
        if (!previous || Date.parse(date) < Date.parse(previous.releasedAt)) {
          dates.set(name, { releasedAt: date, sourceUrl: link.url });
        }
      }
    });
  });
  if (!tableCount || !rowCount) throw new Error('未找到活动时间表，已停止导入');
  return dates;
}

function groupsFromTable($, table, line) {
  const groups = [];
  let carry = null;
  const rows = $(table).find('> tbody > tr');
  rows.slice(1).each((_, row) => {
    const headers = $(row).children('th');
    const cells = $(row).children('td');
    if (cells.length !== 1 || !headers.length || headers.length > 2) throw new Error('剧情表结构变化，已停止导入');
    let title;
    let category;
    if (headers.length === 1) {
      if (!carry || carry.remaining < 1) throw new Error('剧情表 rowspan 无法匹配');
      category = carry.category;
      title = clean(headers.eq(0).text());
      carry.remaining--;
    } else if (headers.eq(0).attr('rowspan') !== undefined) {
      const span = Number(headers.eq(0).attr('rowspan'));
      if (!Number.isSafeInteger(span) || span < 1) throw new Error('剧情表 rowspan 无效');
      category = clean(headers.eq(0).text());
      title = clean(headers.eq(1).text());
      carry = { category, remaining: span - 1 };
    } else {
      if (carry?.remaining > 0) throw new Error('剧情表 rowspan 不完整');
      title = clean(headers.eq(0).text());
      category = clean(headers.eq(1).text());
      carry = null;
    }
    if (!title || !category) throw new Error('剧情分组名称缺失');
    const stories = cells.find('a[href]').map((_, anchor) => {
      const href = $(anchor).attr('href');
      const title = clean($(anchor).text());
      if (!title) throw new Error('剧情标题缺失');
      const link = pageLink(href);
      return { title, sourceKey: storyIdentity(href), sourceUrl: link.url, page: link.page };
    }).get();
    if (!stories.length) throw new Error(`剧情分组没有可导入链接：${title}`);
    const chapters = [...new Set(stories.map(story => story.page.match(/^(\d+)-\d+(?:\s|\/)/u)?.[1]).filter(Boolean))];
    const sourceKey = line === 'main' && category === '主线' && chapters.length === 1
      ? `prts:chapter:${chapters[0]}`
      : `prts:group:${line}:${nameKey(category)}:${nameKey(title)}`;
    groups.push({ title, category, stories, sourceKey, line, index: groups.length });
  });
  if (carry?.remaining > 0) throw new Error('剧情表在 rowspan 结束前中断');
  if (!groups.length) throw new Error('剧情表为空');
  return groups;
}

export function parsePrts(storyHtml, eventHtml) {
  const dates = parseEvents(eventHtml);
  const $ = load(storyHtml);
  const allGroups = [];
  for (const [heading, line] of [['主线剧情一览', 'main'], ['活动剧情一览', 'events']]) {
    const tables = $('table.wikitable').filter((_, table) => clean($(table).find('> tbody > tr').first().text()) === heading);
    if (tables.length !== 1) throw new Error(`未找到唯一的${heading}，已停止导入`);
    allGroups.push(...groupsFromTable($, tables[0], line));
  }
  const warnings = [];
  const nodes = [];
  const seen = new Set();
  const push = node => {
    if (seen.has(node.sourceKey)) throw new Error(`剧情标识重复，无法可靠匹配：${node.sourceKey}`);
    seen.add(node.sourceKey);
    nodes.push(node);
  };
  for (const line of ['main', 'events']) {
    const groups = allGroups.filter(group => group.line === line).map(group => ({ ...group, release: dates.get(nameKey(group.title)) }));
    if (line === 'events') {
      groups.sort((a, b) => (a.release ? Date.parse(a.release.releasedAt) : Infinity)
        - (b.release ? Date.parse(b.release.releasedAt) : Infinity) || a.index - b.index);
    }
    const categories = new Set();
    for (const [index, group] of groups.entries()) {
      const categoryKey = `prts:category:${line}:${nameKey(group.category)}`;
      if (!categories.has(categoryKey)) {
        push({ sourceKey: categoryKey, storyLineId: line, parentKey: null, title: group.category, order: categories.size });
        categories.add(categoryKey);
      }
      if (!group.release) warnings.push(`未匹配首次开放时间：${group.title}（${group.category}）；保留剧情，不猜测日期。`);
      push({ sourceKey: group.sourceKey, storyLineId: line, parentKey: categoryKey, title: group.title, order: index,
        releasedAt: group.release?.releasedAt ?? null, sourceUrl: group.release?.sourceUrl ?? STORY_URL });
      for (const [order, story] of group.stories.entries()) {
        push({ sourceKey: story.sourceKey, storyLineId: line, parentKey: group.sourceKey, title: story.title,
          order, sourceUrl: story.sourceUrl });
      }
    }
  }
  return { apiVersion: 1, catalog: {
    importerId: 'prts', game: { id: 'arknights', title: '明日方舟' },
    storyLines: [{ id: 'main', title: '主线剧情', order: 0 }, { id: 'events', title: '活动剧情', order: 1 }], nodes,
  }, warnings };
}
