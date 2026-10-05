import { readFileSync } from 'node:fs';
const reference = JSON.parse(readFileSync(new URL('./chinese-names.json', import.meta.url), 'utf8'));

export function applyNames(output, data = reference) {
  if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data.checkedAt) || !data.names || typeof data.names !== 'object' || Array.isArray(data.names)) {
    throw new Error('中文名称对照表无效');
  }
  const translations = new Map(Object.entries(data.names));
  for (const [key, row] of translations) {
    if (!key.startsWith('iop:') || !row || typeof row.originalTitle !== 'string' || !row.originalTitle.trim()
      || typeof row.title !== 'string' || !row.title.trim() || typeof row.sourceTitle !== 'string' || !row.sourceTitle.trim()
      || typeof row.sourceUrl !== 'string' || !/^https:\/\/(gfwiki\.org\/w\/|iopwiki\.com\/wiki\/)/.test(row.sourceUrl)) {
      throw new Error('中文名称对照条目无效：' + key);
    }
  }
  let applied = 0, stale = 0;
  const nodes = output.catalog.nodes.map(node => {
    const row = translations.get(node.sourceKey);
    if (!row) return node;
    // New upstream titles require review; a stable identifier alone is not proof of an unchanged scene.
    if (node.title !== row.originalTitle) { stale++; return node; }
    applied++;
    return { ...node, title: row.title, sourceUrl: row.sourceUrl };
  });
  const warnings = output.warnings.filter(s => !s.startsWith('IOP 使用英文关卡名'));
  warnings.push('中文名称对照核对于 ' + data.checkedAt + '：' + applied + ' 个章节／剧情名称采用 GFWiki 等来源；未核实的条目保留 IOP 原名，目录不代表服务器开放进度。');
  if (stale) warnings.push(stale + ' 个来源标题已变化，中文对照暂不应用，需重新核对。');
  return { ...output, catalog: { ...output.catalog, nodes }, warnings };
}
