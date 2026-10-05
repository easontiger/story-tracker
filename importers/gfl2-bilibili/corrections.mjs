import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const manualSplits = JSON.parse(readFileSync(new URL('./splits.json', import.meta.url), 'utf8'));

const residentKey = 'video:BV1QJ4m137jh';
const splits = new Map([
  ['UA1-1 意外的发现、UA1-2 绝妙伪装',
    ['UA1-1 意外的发现', 'UA1-2 绝妙伪装', 'UA1-2']],
  ['UA-1-5隐匿的危机、UA-1-6诡异幽灵',
    ['UA-1-5 隐匿的危机', 'UA-1-6 诡异幽灵', 'UA-1-6']],
]);

export function splitResidentStages(output) {
  const children = output.catalog.nodes.filter(node => node.parentKey === residentKey)
    .sort((a, b) => a.order - b.order || a.sourceKey.localeCompare(b.sourceKey));
  if (!children.some(node => splits.has(node.title))) return output;
  const keys = new Set(output.catalog.nodes.map(node => node.sourceKey));
  const replacements = [];
  for (const node of children) {
    const split = splits.get(node.title);
    if (!split) replacements.push({ ...node });
    else {
      const sourceKey = node.sourceKey + ':split:' + split[2];
      if (keys.has(sourceKey)) throw new Error('拆分关卡标识重复：' + sourceKey);
      keys.add(sourceKey);
      // Keep the old identifier on the first stage so existing progress survives.
      replacements.push({ ...node, title: split[0] }, { ...node, sourceKey, title: split[1] });
    }
  }
  replacements.forEach((node, order) => { node.order = order; });
  let inserted = false;
  output.catalog.nodes = output.catalog.nodes.flatMap(node => {
    if (node.parentKey !== residentKey) return [node];
    if (inserted) return [];
    inserted = true;
    return replacements;
  });
  const warning = '驻行者合并关卡已拆分；原已看标记保留在每组第一关，新增第二关需单独标记；视频链接仍指向原合并片段。';
  if (!output.warnings.includes(warning)) output.warnings.push(warning);
  return output;
}

export function splitMergedStories(output) {
  const rules = new Map(manualSplits.map(rule => [rule.sourceKey, rule]));
  const keys = new Set(output.catalog.nodes.map(node => node.sourceKey));
  const children = new Map();
  for (const node of output.catalog.nodes) {
    if (node.parentKey !== null) {
      if (!children.has(node.parentKey)) children.set(node.parentKey, []);
      children.get(node.parentKey).push(node);
    }
  }
  const replacements = new Map();
  for (const [parentKey, siblings] of children) {
    if (!siblings.some(node => rules.get(node.sourceKey)?.title === node.title)) continue;
    const ordered = [...siblings].sort((a, b) => a.order - b.order || a.sourceKey.localeCompare(b.sourceKey));
    const corrected = [];
    for (const node of ordered) {
      const rule = rules.get(node.sourceKey);
      if (!rule || rule.title !== node.title) {
        corrected.push({ ...node });
        continue;
      }
      if (rule.parentKey !== parentKey || rule.parts.length < 2
        || rule.parts.some(title => !title.trim()) || new Set(rule.parts).size !== rule.parts.length) {
        throw new Error('手工拆分规则无效：' + node.sourceKey);
      }
      rule.parts.forEach((title, index) => {
        const sourceKey = index === 0 ? node.sourceKey
          : node.sourceKey + ':split:' + createHash('sha256').update(title).digest('hex').slice(0, 24);
        if (index > 0 && keys.has(sourceKey)) throw new Error('拆分关卡标识重复：' + sourceKey);
        keys.add(sourceKey);
        corrected.push({ ...node, sourceKey, title });
      });
    }
    corrected.forEach((node, order) => { node.order = order; });
    replacements.set(parentKey, corrected);
  }
  if (!replacements.size) return output;
  const inserted = new Set();
  const nodes = output.catalog.nodes.flatMap(node => {
    if (!replacements.has(node.parentKey)) return [node];
    if (inserted.has(node.parentKey)) return [];
    inserted.add(node.parentKey);
    return replacements.get(node.parentKey);
  });
  output.catalog.nodes = nodes;
  const warning = '手工拆分合并剧情：原已看标记保留在每组第一项，新增项需单独标记；战前战后合并记录，视频链接仍指向原片段。';
  if (!output.warnings.includes(warning)) output.warnings.push(warning);
  return output;
}
