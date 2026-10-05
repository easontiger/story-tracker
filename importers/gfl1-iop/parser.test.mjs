import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseImportResult } from '../../src/catalog.ts';
import { applyDates } from './dates.mjs';
import { readHtml, parseGroups as parseLocalized, parseLive as parseLocalizedLive } from './parser.mjs';
import { applyNames } from './names.mjs';
const parseGroups = (groups, baseline) => parseLocalized(groups, baseline, { localize: false });
const parseLive = (html, snapshot) => parseLocalizedLive(html, snapshot, { localize: false });
const snapshot = JSON.parse(readFileSync(new URL('./story-list.json', import.meta.url), 'utf8'));
const group = (stages) => ({ section: 'Main Story', title: 'Episode 01 - Awakening', stages: stages.map(title => ({ title })) });
const html = groups => '<div class="mw-parser-output">' + groups.map(g => '<h2>' + g.section + '</h2><h3>' + g.title + '</h3>' + g.stages.map(s => '<h4>' + s.title + '</h4><p>Part1 (Script) - Part2 (Script)</p>').join('')).join('') + '</div>';
test('真实列表通过主程序校验，三个活动各计一个完整剧情', () => {
  const output = parseGroups(snapshot.groups);
  parseImportResult(output);
  assert.equal(output.catalog.nodes.filter(n => n.parentKey !== null).length, 1214);
  assert.equal(output.catalog.nodes.filter(n => n.parentKey === null).length, 62);
  const parents = new Set(output.catalog.nodes.map(n => n.parentKey));
  assert.equal(output.catalog.nodes.filter(n => !parents.has(n.sourceKey)).length, 1217);
  for (const title of ['White Day 2022: Love Bakery', 'Summer 2022: Lycan Sanctuary', 'The Glistening Bloom (Zombie Land Saga collab)']) {
    const matches = output.catalog.nodes.filter(n => n.title === title);
    assert.equal(matches.length, 1);
    assert(!parents.has(matches[0].sourceKey));
  }
  assert.equal(output.catalog.storyLines.length, 4);
  assert.equal(output.warnings.filter(s => s.includes('尚未列出关卡')).length, 0);
  assert(output.catalog.nodes.every(n => /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(n.releasedAt)));
  assert(output.catalog.nodes.some(n => n.title.startsWith('Episode 15.9')));
});
test('战前战后合为关卡，导航目录与其他剧情页面不混入', () => {
  const data = '<div class="mw-parser-output"><div class="toc"><h2>Main Story</h2><h3>Fake</h3><h4>Fake</h4></div><h2>Main Story<span class="mw-editsection">[edit]</span></h2><h3>Prologue</h3><h4>Prologue</h4><p>Slides (Script)</p><h3>Episode 01 - Awakening</h3><h4>Normal 1-1: Drill</h4><p>Part1 (Script) - Part2 (Script)</p><h4>Emergency 1-1: Drill</h4><p>Part1 (Script)</p><h2>Notes</h2><h3>Navigation</h3><h4>Fake</h4></div>';
  const output = parseGroups(readHtml(data));
  assert.deepEqual(output.catalog.nodes.filter(n => n.parentKey).map(n => n.title), ['Prologue', 'Normal 1-1: Drill', 'Emergency 1-1: Drill']);
});
test('唯一关卡编号改名或乱序仍使用原标识，观看记录可匹配', () => {
  const old = [group(['Normal 1-1: Drill', 'Normal 1-2: Test'])];
  const next = [group(['Normal 1-2: Renamed', 'Normal 1-1: Drill'])];
  const before = parseGroups(old);
  const after = parseGroups(next, old);
  assert.deepEqual(new Set(before.catalog.nodes.map(n => n.sourceKey)), new Set(after.catalog.nodes.map(n => n.sourceKey)));
});
test('重复编号的不同关卡分别保留，无法可靠改名时停止', () => {
  const old = [group(['E1-1B: The Curtain Rises I', 'E1-1B: The Curtain Rises II'])];
  assert.equal(parseGroups(old).catalog.nodes.length, 3);
  assert.throws(() => parseGroups([group(['E1-1B: Renamed', 'E1-1B: The Curtain Rises II'])], old), /人工核对/);
});
test('DRF24按所属章区别，保留四章的四个条目', () => {
  const output = parseGroups(snapshot.groups);
  assert.deepEqual(output.catalog.nodes.filter(n => n.title.startsWith('DRF24')).map(n => n.title), ['DRF24（第1章）', 'DRF24（第2章）', 'DRF24（第3章）', 'DRF24（第4章）']);
});
test('防护页、重复关卡、缩减正文拒绝更新', () => {
  assert.throws(() => readHtml('<html>Just a moment...</html>'), /有效剧情/);
  assert.throws(() => parseGroups([group(['Normal 1-1: Drill', 'Normal 1-1: Drill'])]), /重复/);
  const baseline = { groups: [group(['Normal 1-1: Drill', 'Normal 1-2: Test'])] };
  assert.throws(() => parseLive(html([group(['Normal 1-1: Drill'])]), baseline), /停止更新/);
  assert.throws(() => parseLive(html([{ ...group(['Normal 2-1: Test']), title: 'Episode 02 - Echo' }]), baseline), /停止更新/);
});

test('日期更新保留所有剧情标识，夜战使用独立日期', () => {
  const output = parseGroups(snapshot.groups);
  const first = output.catalog.nodes.find(n => n.title.startsWith('Normal 1-1:'));
  const night = output.catalog.nodes.find(n => n.title.startsWith('Night 1-1:'));
  assert.equal(first.releasedAt, '2016-05-20');
  assert.equal(night.releasedAt, '2016-09-22');
  assert.equal(output.catalog.nodes.find(n => n.title === 'Summer 2022: Lycan Sanctuary').releasedAt, '2022-07-21');
  assert.equal(output.catalog.nodes.find(n => n.title === 'The Glistening Bloom (Zombie Land Saga collab)').releasedAt, '2023-02-17');
  const before = { ...output, catalog: { ...output.catalog, nodes: output.catalog.nodes.map(n => ({ ...n, releasedAt: null })) } };
  const after = applyDates(before);
  assert.deepEqual(after.catalog.nodes.map(n => n.sourceKey), before.catalog.nodes.map(n => n.sourceKey));
  assert.deepEqual(after.catalog.nodes, output.catalog.nodes);
});
test('新章节不猜日期，异常或外服日期表拒绝使用', () => {
  const output = parseGroups([{ ...group(['Normal 99-1: New']), title: 'Episode 99 - New' }]);
  assert(output.catalog.nodes.every(n => n.releasedAt === null));
  assert(output.warnings.some(s => s.includes('缺少可靠')));
  const projects = [{ server: 'EN', releasedAt: '2020-01-01', sourceKey: 'test' }];
  assert.throws(() => applyDates(output, { projects, night: [] }), /国服日期表/);
  assert.throws(() => applyDates(output, { projects: [{ ...projects[0], server: 'CN', releasedAt: '2020-02-30' }], night: [] }), /国服日期表/);
});

test('中文名称覆盖不改变剧情标识、层级、日期或排序', () => {
  const before = parseGroups(snapshot.groups);
  const after = parseLocalized(snapshot.groups);
  parseImportResult(after);
  assert.equal(after.catalog.nodes.length, 1276);
  assert.deepEqual(applyDates(after).catalog.nodes, after.catalog.nodes);
  assert.deepEqual(after.catalog.nodes.map(({ title, sourceUrl, ...node }) => node),
    before.catalog.nodes.map(({ title, sourceUrl, ...node }) => node));
  assert(after.catalog.nodes.some(n => n.title === '普通 1-1：演习训练'));
  assert(after.catalog.nodes.some(n => n.title === '焙炒爱意'));
  assert(after.catalog.nodes.some(n => n.title === '里坎禁猎区'));
  // Differing source order never becomes a translation-by-index rule.
  assert(after.catalog.nodes.some(n => n.title === 'E1-B：调和模拟'));
  assert(after.catalog.nodes.some(n => n.title === 'E1-1B：帷幕将升I'));
  assert(after.catalog.nodes.some(n => n.title === 'E1-1B：帷幕将升II'));
});
test('来源改名时不套用旧中文名，异常对照表拒绝使用', () => {
  const before = parseGroups(snapshot.groups);
  const key = before.catalog.nodes.find(n => n.title === 'Normal 1-1: Drill').sourceKey;
  const modified = { ...before, catalog: { ...before.catalog, nodes: before.catalog.nodes.map(n =>
    n.sourceKey === key ? { ...n, title: 'Normal 1-1: A different story' } : n) } };
  const after = applyNames(modified);
  assert.equal(after.catalog.nodes.find(n => n.sourceKey === key).title, 'Normal 1-1: A different story');
  assert(after.warnings.some(s => s.includes('来源标题已变化')));
  assert.throws(() => applyNames(before, { checkedAt: '2026-10-05', names: {
    [key]: { originalTitle: 'Normal 1-1: Drill', title: '演习训练', sourceTitle: '演习训练', sourceUrl: 'http://invalid' }
  } }), /对照条目无效/);
});
