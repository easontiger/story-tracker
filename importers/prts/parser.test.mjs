import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePrts, parseEvents, storyIdentity } from './parser.mjs';

const link = (page, title) => `<a href="/w/${encodeURIComponent(page)}">${title}</a>`;
const row = (title, kind, links) => `<tr><th>${title}</th><th>${kind}</th><td>${links}</td></tr>`;
const table = (heading, rows) => `<table class="wikitable"><tbody><tr><th colspan="3">${heading}</th></tr>${rows}</tbody></table>`;
const stories = table('主线剧情一览', row('黑暗时代·上', '主线', link('0-1 坍塌/BEG', '0-1 坍塌 行动前') + link('0-1 坍塌/END', '0-1 坍塌 行动后')))
  + table('活动剧情一览', `<tr><th rowspan="2">特殊</th><th>危机合约</th><td>${link('CC/剧情', '危机合约')}</td></tr>
    <tr><th>长夜临光</th><td>${link('NL-HD-1/NBT', '逃离')}</td></tr>`
    + row('午间逸话', '剧情', link('SW-ST1 晨间/剧情', '晨间'))
    + row('骑兵与猎人', '支线', link('GT-1 日正当中/BEG', 'GT-1 日正当中 行动前') + link('GT-1 日正当中/END', 'GT-1 日正当中 行动后'))
    + row('无日期活动', '支线', link('ZZ-ST1/NBT', '未知')));
const eventRow = (date, page, name, category = '支线故事') => `<tr><td>${date}</td><td>${link(page, name)}</td><td>${category}</td><td></td></tr>`;
const events = `<table class="wikitable"><tbody><tr><th>活动开始时间</th><th>活动页面</th><th>活动分类</th><th>官网公告</th></tr>
  ${eventRow('2020-10-01 16:00', '骑兵与猎人2020', '骑兵与猎人·复刻', '支线故事 复刻活动')}
  ${eventRow('2019-05-30 10:00', '骑兵与猎人', '骑兵与猎人')}
  ${eventRow('2021-11-01 16:00', '长夜临光', '长夜临光')}
  ${eventRow('2020-02-25 16:00', '午间逸话', '午间逸话')}
</tbody></table>`;

test('uses first-run dates, preserves BEG/END, and expands rowspan groups', () => {
  const output = parsePrts(stories, events);
  const nodes = output.catalog.nodes;
  assert.equal(output.catalog.game.id, 'arknights');
  const gt = nodes.find(n => n.title === '骑兵与猎人');
  assert.equal(gt.releasedAt, '2019-05-30');
  assert.equal(nodes.filter(n => n.parentKey === gt.sourceKey).length, 2);
  assert.ok(nodes.some(n => n.sourceKey === 'prts:story:GT-1/BEG'));
  assert.ok(nodes.some(n => n.sourceKey === 'prts:story:GT-1/END'));
  const special = nodes.find(n => n.title === '特殊' && n.storyLineId === 'events');
  assert.equal(nodes.filter(n => n.parentKey === special.sourceKey).length, 2);
  assert.ok(output.warnings.some(w => w.includes('无日期活动')));
  assert.equal(nodes.find(n => n.title === '无日期活动').releasedAt, null);
});

test('stage identity survives display-title changes and link encoding variations', () => {
  assert.equal(storyIdentity('/w/GT-1_日正当中/BEG'), storyIdentity('/w/GT-1_新的名字/BEG'));
  assert.equal(storyIdentity('/w/GT-1_日正当中/BEG'), storyIdentity('/w/GT-1_%E6%97%A5%E6%AD%A3%E5%BD%93%E4%B8%AD/BEG'));
  const renamed = parsePrts(stories.replace('黑暗时代·上', '新的章节名'), events);
  assert.ok(renamed.catalog.nodes.some(n => n.sourceKey === 'prts:chapter:0' && n.title === '新的章节名'));
  assert.notEqual(storyIdentity('/w/GT-1_日正当中/BEG'), storyIdentity('/w/GT-1_日正当中/END'));
});

test('ignores desktop navigation copies instead of duplicating the story table', () => {
  const output = parsePrts(stories + `<table class="navbox"><tr><td>${link('0-1 坍塌/BEG', '导航副本')}</td></tr></table>`, events);
  assert.equal(output.catalog.nodes.filter(n => n.sourceKey === 'prts:story:0-1/BEG').length, 1);
});

test('date matching does not guess names or use reruns as first releases', () => {
  const dates = parseEvents(events);
  assert.equal(dates.get('骑兵与猎人').releasedAt, '2019-05-30');
  assert.equal(dates.has('骑兵与猎人2020'), false);
  assert.equal(dates.has('不相关的活动'), false);
});

test('rejects missing tables, truncated rowspan, malformed dates, duplicate identities and external links', () => {
  assert.throws(() => parsePrts('<html>Access denied</html>', events));
  assert.throws(() => parsePrts(stories.replace('rowspan="2"', 'rowspan="3"'), events));
  assert.throws(() => parsePrts(stories, events.replace('2019-05-30', '2019-02-30')));
  assert.throws(() => parsePrts(stories.replace('0-1 坍塌 行动后', '0-1 坍塌 行动前').replace(encodeURIComponent('0-1 坍塌/END'), encodeURIComponent('0-1 坍塌/BEG')), events));
  assert.throws(() => storyIdentity('https://example.com/w/GT-1/BEG'));
  assert.throws(() => parsePrts(stories, '<div>no events</div>'));
});
