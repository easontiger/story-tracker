import { readFileSync } from 'node:fs';
const referenceCorrections = JSON.parse(readFileSync(new URL('./reference-corrections.json', import.meta.url), 'utf8'));

export function applyReferenceCorrections(output, corrections = referenceCorrections) {
  const nodes = output.catalog.nodes.map(node => ({ ...node }));
  const byKey = new Map(nodes.map(node => [node.sourceKey, node]));
  const seen = new Set();
  for (const rule of corrections.nodes) {
    if (seen.has(rule.sourceKey)) throw new Error('参考修正标识重复：' + rule.sourceKey);
    seen.add(rule.sourceKey);
    const previous = byKey.get(rule.sourceKey);
    const parent = rule.parentKey === null ? null : byKey.get(rule.parentKey);
    if (!previous && !parent) throw new Error('参考修正缺少父节点：' + rule.sourceKey);
    if (previous && (previous.parentKey !== rule.parentKey
      || ![rule.expectedTitle, rule.title].includes(previous.title))) {
      throw new Error('参考修正与当前目录不符：' + rule.sourceKey);
    }
    if (previous) {
      previous.title = rule.title;
      previous.sourceUrl = rule.sourceUrl;
      if (rule.order !== undefined) previous.order = rule.order;
    } else {
      const node = {
        sourceKey: rule.sourceKey, parentKey: rule.parentKey,
        storyLineId: parent.storyLineId, title: rule.title, order: rule.order,
        releasedAt: parent.releasedAt ?? null, sourceUrl: rule.sourceUrl,
      };
      nodes.push(node);
      byKey.set(node.sourceKey, node);
    }
  }
  output.catalog.nodes = nodes;
  output.warnings = [...new Set([...output.warnings, ...corrections.warnings])];
  return output;
}
