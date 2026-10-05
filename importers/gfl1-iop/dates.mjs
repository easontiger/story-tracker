import { readFileSync } from 'node:fs';
const reference = JSON.parse(readFileSync(new URL('./dates.json', import.meta.url), 'utf8'));

export function applyDates(output, data = reference) {
  const projects = new Map(), night = new Map();
  const valid = date => {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const value = new Date(date);
    return Number.isFinite(value.getTime()) && value.toISOString().slice(0, 10) === date;
  };
  for (const row of data.projects) {
    if (row.server !== 'CN' || !valid(row.releasedAt) || projects.has(row.sourceKey)) throw new Error('国服日期表无效或重复：' + row.title);
    projects.set(row.sourceKey, row.releasedAt);
  }
  for (const row of data.night) {
    if (row.server !== 'CN' || !valid(row.releasedAt) || night.has(row.episode)) throw new Error('国服夜战日期无效或重复');
    night.set(row.episode, row.releasedAt);
  }
  const missing = new Set();
  const nodes = output.catalog.nodes.map(node => {
    const projectKey = node.parentKey ?? node.sourceKey;
    let releasedAt = projects.get(projectKey) ?? null;
    if (node.storyLineId === 'main' && /^(?:Night |夜战 )/.test(node.title)) {
      const episode = Number(projectKey.match(/:episode:(\d+)$/)?.[1]);
      releasedAt = night.get(episode) ?? null;
    }
    if (releasedAt === null) missing.add(projectKey);
    return { ...node, releasedAt };
  });
  const warnings = [...output.warnings];
  if (missing.size) warnings.push(missing.size + ' 个章节或活动仍缺少可靠的国服日期，暂留空。');
  return { ...output, catalog: { ...output.catalog, nodes }, warnings };
}
