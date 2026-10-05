const parentKey = 'supplement:main:0.0-phase-counter';
const storyKey = parentKey + ':upper';
const mergedKeys = new Set(['middle', 'lower', 'conclusion'].map(key => parentKey + ':' + key));

// Keep the original chapter and first-stage identifiers when merging chapter zero.
export function supplementMain(output) {
  const nodes = [
    { sourceKey: parentKey, storyLineId: 'main', parentKey: null,
      title: '第0章 相位反制', order: 0, releasedAt: '2023-12-21' },
    { sourceKey: storyKey, storyLineId: 'main', parentKey,
      title: '相位反制', order: 0, releasedAt: '2023-12-21' },
  ];
  for (const node of nodes) {
    const previous = output.catalog.nodes.find(item => item.sourceKey === node.sourceKey);
    if (previous && (previous.parentKey !== node.parentKey || previous.storyLineId !== node.storyLineId)) {
      throw new Error('补充剧情标识冲突：' + node.sourceKey);
    }
  }
  output.catalog.nodes = output.catalog.nodes.filter(node => !mergedKeys.has(node.sourceKey));
  for (const node of nodes) {
    const previous = output.catalog.nodes.find(item => item.sourceKey === node.sourceKey);
    if (!previous) output.catalog.nodes.push(node);
    else Object.assign(previous, node);
  }
  output.warnings = output.warnings.filter(item => !item.startsWith('用户补充：0.0 相位反制'));
  const warning = '第0章 相位反制按一个剧情记录，开放日期为 2023-12-21；合并前中、下、结若有观看记录，将保留并报告为孤立记录。';
  if (!output.warnings.includes(warning)) output.warnings.push(warning);
  return output;
}
