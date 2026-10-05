import { applyReferenceCorrections } from './reference.mjs';
import { readFileSync } from 'node:fs';
const manualSplitRules = JSON.parse(readFileSync(new URL('./splits.json', import.meta.url), 'utf8'));
import { splitResidentStages, splitMergedStories } from './corrections.mjs';
import { supplementMain } from './supplement.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGfl2, beijingDay, updateEventDates } from './parser.mjs';
const video = (bvid, title, pages) => ({ bvid, title: '[少前2]剧情【' + title + '/4K】', pages });
const page = (cid, part, number = 1) => ({ cid, part, page: number });
const sample = () => ({
  main: [video('BV1unaj61Ec4', '第26章 静默突触（承）', [page(10, 'AA-2-1 残躯为誓'), page(11, '4K合集（一镜到底）', 2)])],
  events: [video('BV1Hatg6uENF', '金翅雀与橄榄枝', [page(20, 'CS-1-1 长梦初醒')])],
  eventDates: [{ title: '静默突触', startUtc: '2026-09-22T04:00:00Z', server: 'CN' }, { title: '金翅雀与橄榄枝', startUtc: '2026-09-01T04:00:00Z', server: 'CN' }],
});
test('使用北京时间的 IOP 日期，排除合并版而保留关卡', () => {
  const output = parseGfl2(sample());
  assert.equal(output.catalog.nodes.length, 4);
  assert.equal(output.catalog.nodes[0].releasedAt, '2026-09-22');
  assert.equal(output.catalog.nodes[1].title, 'AA-2-1 残躯为誓');
  assert.equal(beijingDay(Date.parse('2026-09-19T17:00:00Z') / 1000), '2026-09-20');
});
test('没有匹配 IOP 时不使用上传时间、其他活动或其他分篇日期', () => {
  const data = sample();
  data.eventDates[0].title = '静默突触·下篇';
  data.main[0].pubdate = 1789894800;
  const output = parseGfl2(data);
  assert.equal(output.catalog.nodes[0].releasedAt, null);
  assert.ok(output.warnings.some(item => item.includes('留空')));
});
test('分 P 改名、重新排序后，观看记录标识保持稳定', () => {
  const before = parseGfl2(sample()).catalog.nodes;
  const data = sample();
  data.main[0].pages[0].part = 'AA-2-1 修订标题';
  data.main[0].pages[0].page = 3;
  const after = parseGfl2(data).catalog.nodes;
  assert.equal(before[1].sourceKey, after[1].sourceKey);
  assert.equal(after[1].sourceUrl.endsWith('?p=3'), true);
});
test('整章视频不会被过滤掉；空目录和重复 CID 拒绝输出', () => {
  const data = sample();
  data.main[0].pages = [page(10, '4K合集（一镜到底）')];
  assert.equal(parseGfl2(data).catalog.nodes[1].title, '整章剧情');
  data.main[0].pages = [];
  assert.throws(() => parseGfl2(data), /目录格式无效/);
  data.main[0].pages = [page(10, 'AA-2-1 残躯为誓'), page(10, 'AA-2-2 同舟共济', 2)];
  assert.throws(() => parseGfl2(data), /标识重复/);
});

test('中文章号按数字排序并匹配 IOP；改版不重复导入旧版', () => {
  const data = sample();
  data.main = [
    video('BV1unaj61Ec4', '第十章 静默突触（承）', [page(10, 'AA-2-1 残躯为誓')]),
    video('BV1jb4y137Yu', '第9章 静默突触（初）', [page(30, '新剧情（新版）'), page(31, '剧情（旧版）', 2)]),
  ];
  data.main[1].title += ' 改版剧情';
  const nodes = parseGfl2(data).catalog.nodes;
  assert.ok(nodes[0].title.startsWith('第9章'));
  assert.equal(nodes.filter(node => node.parentKey && node.sourceKey.includes('BV1jb4y137Yu')).length, 1);
  assert.equal(nodes.find(node => node.title.startsWith('第十章')).releasedAt, '2026-09-22');
});

test('读取时间轴章节，拆分同段多关卡并去除重复战前战后编号', () => {
  const data = sample();
  data.main[0].pages = [page(10, '整章视频')];
  data.main[0].pages[0].chapters = [
    { type: 2, from: 0, to: 60, content: 'SL-5-1 颠簸摇篮、5-1 突围I' },
    { type: 2, from: 60, to: 90, content: '5-1 突围I 战后' },
    { type: 2, from: 90, to: 100, content: '5-3 瞬态反射' },
  ];
  const output = parseGfl2(data);
  const leaves = output.catalog.nodes.filter(node => node.parentKey === 'video:BV1unaj61Ec4');
  assert.deepEqual(leaves.map(node => node.title), ['SL-5-1 颠簸摇篮', '5-1 突围I', '5-3 瞬态反射']);
  assert.equal(leaves[2].sourceUrl.endsWith('&t=90'), true);
  data.main[0].pages[0].chapters[2].from = 95;
  assert.equal(parseGfl2(data).catalog.nodes.find(node => node.title === '5-3 瞬态反射').sourceKey, leaves[2].sourceKey);
});
test('拒绝异常时间轴，避免输出错误目录', () => {
  const data = sample();
  data.main[0].pages = [page(10, '整章视频')];
  data.main[0].pages[0].chapters = [{ type: 2, from: -1, to: 50, content: '5-1 突围I' }];
  assert.throws(() => parseGfl2(data), /章节时间/);
});

test('改版覆盖明确声明的原活动，保留改版标识和原 IOP 日期，其他活动不受影响', () => {
  const data = sample();
  data.main = [video('BV1UiBvYSEto', '第8.3章 于灰败的羽翼中', [page(30, 'GS-1-1 花圃中的旧识')])];
  data.main[0].title += ' 改版剧情（原【异乡乐徽】剧情）';
  const original = video('BV1YN4y1z7f9', '异乡乐徽', [page(40, 'AD-1-1 庆典的序章')]);
  data.eventDates.push({ title: '异乡乐徽', startUtc: '2023-12-25T10:00:00Z', server: 'CN' });
  const before = parseGfl2(data).catalog.nodes;
  data.events.push(original);
  const after = parseGfl2(data);
  assert.ok(!after.catalog.nodes.some(node => node.sourceKey.includes(original.bvid)));
  assert.equal(after.catalog.nodes.find(node => node.title.includes('第8.3章')).releasedAt, '2023-12-25');
  assert.equal(after.catalog.nodes.find(node => node.title.startsWith('GS-1-1')).sourceKey, before.find(node => node.title.startsWith('GS-1-1')).sourceKey);
  assert.ok(after.catalog.nodes.some(node => node.title === '金翅雀与橄榄枝'));
  assert.ok(after.warnings.some(item => item.includes('已用改版覆盖原版')));
});
test('未明确声明原版时不覆盖；多个改版指向同一原版时拒绝输出', () => {
  const data = sample();
  data.main[0].title += ' 改版剧情';
  data.events.push(video('BV1YN4y1z7f9', '静默突触', [page(40, 'AA-1-1 开始')]));
  assert.ok(parseGfl2(data).catalog.nodes.some(node => node.sourceKey === 'video:BV1YN4y1z7f9'));
  data.main[0].title += '（原【静默突触】剧情）';
  data.main.push({ ...data.main[0], bvid: 'BV1UiBvYSEto' });
  assert.throws(() => parseGfl2(data), /多个改版/);
});

test('分篇精确匹配国服并换算北京时间，复刻和外服不替代首次开放', () => {
  const data = sample();
  data.eventDates = [
    {title:'静默突触·初篇',startUtc:'2026-09-22T04:00:00Z',server:'CN'},
    {title:'静默突触·承篇',startUtc:'2026-09-28T21:00:00Z',server:'CN'},
    {title:'金翅雀与橄榄枝',startUtc:'2026-09-01T04:00:00Z',server:'CN'},
    {title:'金翅雀与橄榄枝',startUtc:'2027-09-01T04:00:00Z',server:'CN'},
    {title:'金翅雀与橄榄枝',startUtc:'2025-09-01T04:00:00Z',server:'EN'},
  ];
  const nodes = parseGfl2(data).catalog.nodes;
  assert.equal(nodes[0].releasedAt,'2026-09-29');
  assert.equal(nodes.find(node => node.title === '金翅雀与橄榄枝').releasedAt,'2026-09-01');
});

test('仅更新 JSON 日期，不改变节点标识、标题、目录及视频来源', () => {
  const output = parseGfl2(sample());
  const previous = structuredClone(output);
  const rows = sample().eventDates;
  rows[0].startUtc = '2026-09-28T21:00:00Z';
  updateEventDates(output, rows);
  assert.equal(output.catalog.nodes[0].releasedAt, '2026-09-29');
  const withoutDates = nodes => nodes.map(({ releasedAt, ...node }) => node);
  assert.deepEqual(withoutDates(output.catalog.nodes), withoutDates(previous.catalog.nodes));
  assert.deepEqual(output.catalog.game, previous.catalog.game);
});

test('用户章节日期同时应用于重新导入和已有 JSON，并保留原有节点标识', () => {
  const data = sample();
  data.main = [
    video('BV1jb4y137Yu','第1章 双摆推演',[page(30,'1-1 开始')]),
    video('BV1Hatg6uENF','第7章 放射衰变',[page(31,'7-1 开始')]),
    video('BV1unaj61Ec4','第8章 叠影效应',[page(32,'8-1 开始')]),
  ];
  data.events = [video('BV1YN4y1z7f9','金翅雀与橄榄枝',[page(40,'CS-1-1 长梦初醒')])];
  const before = parseGfl2(data);
  data.chapterDates = [
    {chapter:1,releasedAt:'2023-12-21',note:'第1～4章内测时已有；2023-12-21为国服正式上线日期。'},
    {chapter:7,releasedAt:'2024-01-23'},
    {chapter:8,releasedAt:'2024-03-26'},
  ];
  const fresh = parseGfl2(data);
  const updated = updateEventDates(structuredClone(before),data.eventDates,data.chapterDates);
  assert.deepEqual(fresh.catalog,updated.catalog);
  assert.deepEqual(fresh.catalog.nodes.map(node=>node.sourceKey),before.catalog.nodes.map(node=>node.sourceKey));
  assert.deepEqual(fresh.catalog.nodes.filter(node=>node.storyLineId==='main' && node.parentKey===null).map(node=>node.releasedAt),
    ['2023-12-21','2024-01-23','2024-03-26']);
  assert.equal(fresh.warnings.filter(item=>item.includes('内测')).length,1);
  assert.ok(!updated.warnings.some(item=>item.includes('留空')));
});
test('章节补充日期拒绝不存在的日期和重复章号', () => {
  const data = sample();
  data.chapterDates=[{chapter:1,releasedAt:'2024-02-30'}];
  assert.throws(()=>parseGfl2(data),/章节日期/);
  data.chapterDates=[{chapter:1,releasedAt:'2023-12-21'},{chapter:1,releasedAt:'2024-01-23'}];
  assert.throws(()=>parseGfl2(data),/章号重复/);
});

test('第0章合并为一个剧情，重复处理不增加节点且原目录保持不变', () => {
  const output = parseGfl2(sample());
  const previous = structuredClone(output.catalog.nodes);
  supplementMain(output);
  const root = output.catalog.nodes.find(node => node.title === '第0章 相位反制');
  assert.equal(root.storyLineId, 'main');
  const stages = output.catalog.nodes.filter(node => node.parentKey === root.sourceKey);
  assert.deepEqual(stages.map(node => node.title), ['相位反制']);
  assert.equal(root.releasedAt, '2023-12-21');
  assert.ok(stages.every(node => node.releasedAt === '2023-12-21'));
  assert.deepEqual(output.catalog.nodes.slice(0, previous.length), previous);
  const once = structuredClone(output);
  root.releasedAt = null;
  root.title = '0.0 相位反制';
  stages[0].title = '相位反制（上）';
  stages.forEach(node => { node.releasedAt = null; });
  for (const key of ['middle','lower','conclusion']) output.catalog.nodes.push({
    ...stages[0], sourceKey: root.sourceKey + ':' + key, title: key,
  });
  assert.deepEqual(supplementMain(output), once);
});

test('驻行者两组合并关卡拆分为四项，保留原标识、日期与链接，重复处理不再新增', () => {
  const parent = 'video:BV1QJ4m137jh';
  const base = { storyLineId: 'main', parentKey: parent, releasedAt: '2024-06-05', sourceUrl: 'https://www.bilibili.com/video/BV1QJ4m137jh/?p=1&t=0' };
  const nodes = [
    { ...base, sourceKey: parent, parentKey: null, title: '第6.5及6.7章 玻璃岛的驻行者', order: 6 },
    { ...base, sourceKey: 'first', title: 'UA1-1 意外的发现、UA1-2 绝妙伪装', order: 0 },
    { ...base, sourceKey: 'between', title: 'US-1-1 旧友', order: 1 },
    { ...base, sourceKey: 'second', title: 'UA-1-5隐匿的危机、UA-1-6诡异幽灵', order: 4 },
    { ...base, sourceKey: 'last', title: 'UA-1-7 最大胆的决定', order: 5 },
    { ...base, sourceKey: 'other', parentKey: 'other-chapter', title: '其他目录', order: 0 },
  ];
  const output = { catalog: { nodes: structuredClone(nodes) }, warnings: [] };
  splitResidentStages(output);
  const children = output.catalog.nodes.filter(node => node.parentKey === parent);
  assert.deepEqual(children.map(node => node.title), [
    'UA1-1 意外的发现', 'UA1-2 绝妙伪装', 'US-1-1 旧友',
    'UA-1-5 隐匿的危机', 'UA-1-6 诡异幽灵', 'UA-1-7 最大胆的决定',
  ]);
  assert.deepEqual(children.map(node => node.order), [0,1,2,3,4,5]);
  assert.equal(children[0].sourceKey, 'first');
  assert.equal(children[3].sourceKey, 'second');
  assert.ok(children.every(node => node.releasedAt === base.releasedAt && node.sourceUrl === base.sourceUrl));
  assert.deepEqual(output.catalog.nodes.find(node => node.sourceKey === 'other'), nodes[5]);
  const once = structuredClone(output);
  assert.deepEqual(splitResidentStages(output), once);
});

test('拆分标识冲突时停止处理，避免覆盖其他节点', () => {
  const parentKey = 'video:BV1QJ4m137jh';
  const output = { catalog: { nodes: [
    { sourceKey: 'first', parentKey, order: 0, title: 'UA1-1 意外的发现、UA1-2 绝妙伪装' },
    { sourceKey: 'first:split:UA1-2', parentKey: null, order: 0, title: '冲突' },
  ] }, warnings: [] };
  const previous = structuredClone(output);
  assert.throws(() => splitResidentStages(output), /标识重复/);
  assert.deepEqual(output, previous);
});

test('手工规则拆分带编号及无编号的合并剧情，保持日期、链接和首项标识', () => {
  const find = title => manualSplitRules.find(rule => rule.title === title);
  const numbered = find('4-6 侵入II、SL-4-3多维悖论');
  const named = find('故意忽视、隐秘调查、暗流汹涌');
  const stage = (rule, order = 0) => ({
    sourceKey: rule.sourceKey, parentKey: rule.parentKey, title: rule.title,
    storyLineId: 'main', order, releasedAt: '2023-12-21', sourceUrl: 'https://www.bilibili.com/video/BV1qp4y1Z7iP/?p=1&t=100',
  });
  const unchanged = { ...stage(numbered, 1), sourceKey: 'untouched', title: '4-7 下一关' };
  const punctuation = { ...stage(named, 1), sourceKey: 'punctuation', title: 'DS-1-2 奢宴、红酒与贵宾' };
  const output = { catalog: { nodes: [stage(numbered), unchanged, stage(named), punctuation] }, warnings: [] };
  splitMergedStories(output);
  const main = output.catalog.nodes.filter(node => node.parentKey === numbered.parentKey);
  assert.deepEqual(main.map(node => node.title), ['4-6 侵入II', 'SL-4-3 多维悖论', '4-7 下一关']);
  assert.deepEqual(main.map(node => node.order), [0, 1, 2]);
  assert.equal(main[0].sourceKey, numbered.sourceKey);
  const names = output.catalog.nodes.filter(node => node.parentKey === named.parentKey);
  assert.deepEqual(names.map(node => node.title), ['故意忽视', '隐秘调查', '暗流汹涌', punctuation.title]);
  assert.equal(names[0].sourceKey, named.sourceKey);
  assert.ok(output.catalog.nodes.every(node => node.releasedAt === unchanged.releasedAt && node.sourceUrl === unchanged.sourceUrl));
  const once = structuredClone(output);
  assert.deepEqual(splitMergedStories(output), once);
});

test('手工拆分出现标识冲突时不留下部分修改', () => {
  const rule = manualSplitRules.find(rule => rule.title === '4-6 侵入II、SL-4-3多维悖论');
  const original = { sourceKey: rule.sourceKey, parentKey: rule.parentKey, title: rule.title, order: 0 };
  const first = { catalog: { nodes: [original] }, warnings: [] };
  splitMergedStories(first);
  const collision = { ...first.catalog.nodes[1], parentKey: 'another', order: 1 };
  const output = { catalog: { nodes: [structuredClone(original), collision] }, warnings: [] };
  const previous = structuredClone(output);
  assert.throws(() => splitMergedStories(output), /标识重复/);
  assert.deepEqual(output, previous);
});

test('补充参考目录保留旧关卡标识与日期，并为新关卡继承活动日期', () => {
  const output = { catalog: { nodes: [
    { sourceKey: 'event', parentKey: null, storyLineId: 'events', title: '忒弥斯棋局', order: 0, releasedAt: '2026-05-19' },
    { sourceKey: 'old-first', parentKey: 'event', storyLineId: 'events', title: 'wa-1-1 心智对弈_1', order: 0, releasedAt: '2026-05-19' },
  ] }, warnings: [] };
  const corrections = { nodes: [
    { sourceKey: 'old-first', parentKey: 'event', expectedTitle: 'wa-1-1 心智对弈_1', title: 'WA-1-1 心智对弈', order: 0, sourceUrl: 'https://www.bilibili.com/video/BV1kKL66sE1q/?p=1' },
    { sourceKey: 'new-second', parentKey: 'event', title: 'WA-1-2 旧城谜影', order: 1, sourceUrl: 'https://www.bilibili.com/video/BV1kKL66sE1q/?p=2' },
  ], warnings: ['参考目录待核对'] };
  applyReferenceCorrections(output, corrections);
  assert.equal(output.catalog.nodes[1].sourceKey, 'old-first');
  assert.equal(output.catalog.nodes[1].title, 'WA-1-1 心智对弈');
  assert.equal(output.catalog.nodes[2].releasedAt, '2026-05-19');
  assert.equal(output.catalog.nodes[2].storyLineId, 'events');
  const once = structuredClone(output);
  assert.deepEqual(applyReferenceCorrections(output, corrections), once);
});

test('参考目录与原标题冲突时拒绝更新，前面的名称修正也不落入结果', () => {
  const output = { catalog: { nodes: [
    { sourceKey: 'first', parentKey: null, title: '原名称' },
    { sourceKey: 'second', parentKey: null, title: '实际不同的名称' },
  ] }, warnings: [] };
  const before = structuredClone(output);
  assert.throws(() => applyReferenceCorrections(output, { nodes: [
    { sourceKey: 'first', parentKey: null, expectedTitle: '原名称', title: '新名称', sourceUrl: 'https://www.bilibili.com/' },
    { sourceKey: 'second', parentKey: null, expectedTitle: '另一个名称', title: '新名称2', sourceUrl: 'https://www.bilibili.com/' },
  ], warnings: [] }), /不符/);
  assert.deepEqual(output, before);
});

test('参考目录缺少父节点或重复标识时拒绝写入', () => {
  const output = { catalog: { nodes: [] }, warnings: [] };
  assert.throws(() => applyReferenceCorrections(output, { nodes: [
    { sourceKey: 'new', parentKey: 'missing', title: '剧情', order: 0 },
  ], warnings: [] }), /父节点/);
  const withRoot = { catalog: { nodes: [{ sourceKey: 'root', parentKey: null, title: '原名' }] }, warnings: [] };
  const rule = { sourceKey: 'root', parentKey: null, expectedTitle: '原名', title: '新名' };
  const before = structuredClone(withRoot);
  assert.throws(() => applyReferenceCorrections(withRoot, { nodes: [rule, rule], warnings: [] }), /重复/);
  assert.deepEqual(withRoot, before);
});
