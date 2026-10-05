import type { StoryCatalog, ImportResult } from './types';

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Catalog 对象无效');
  return value as Record<string, unknown>;
}

function fields(value: Record<string, unknown>, names: string[], optional: string[] = []) {
  if (Object.keys(value).some(key => !names.includes(key) && !optional.includes(key)) || names.some(key => !(key in value))) {
    throw new Error('Catalog 字段缺失或含有未知字段');
  }
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && new TextEncoder().encode(value).length <= 1000 && !value.includes('\0');
}

function order(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }

function releaseDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const day = value.slice(0, 10);
  const parsed = new Date(day);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) return false;
  return value === day || (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)));
}

export function parseCatalog(value: unknown): StoryCatalog {
  const raw = object(value);
  fields(raw, ['game', 'storyLines', 'nodes'], ['importerId']);
  if (raw.importerId !== undefined && raw.importerId !== null && (typeof raw.importerId !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(raw.importerId))) throw new Error('导入模块 ID 无效');
  const game = object(raw.game);
  fields(game, ['id', 'title']);
  if (!text(game.id) || !text(game.title)) throw new Error('游戏 ID 或名称无效');
  if (!Array.isArray(raw.storyLines) || !raw.storyLines.length || !Array.isArray(raw.nodes) || !raw.nodes.length || raw.nodes.length > 10_000) {
    throw new Error('Catalog 必须包含剧情线和 1–10000 个节点');
  }
  const lineIds = new Set<string>();
  const storyLines = raw.storyLines.map(value => {
    const line = object(value);
    fields(line, ['id', 'title', 'order']);
    if (!text(line.id) || !text(line.title) || !order(line.order) || lineIds.has(line.id)) throw new Error('剧情线无效或 ID 重复');
    lineIds.add(line.id);
    return { id: line.id, title: line.title, order: line.order };
  });
  const keys = new Set<string>();
  const nodes = raw.nodes.map(value => {
    const node = object(value);
    fields(node, ['sourceKey', 'storyLineId', 'parentKey', 'title', 'order'], ['releasedAt', 'sourceUrl']);
    if (node.releasedAt !== undefined && node.releasedAt !== null && !releaseDate(node.releasedAt)) throw new Error('开放日期无效');
    if (node.sourceUrl !== undefined && node.sourceUrl !== null && (!text(node.sourceUrl) || !node.sourceUrl.startsWith('https://'))) throw new Error('来源地址必须是 HTTPS');
    if (!text(node.sourceKey) || !text(node.title) || !text(node.storyLineId) || !lineIds.has(node.storyLineId)
      || !order(node.order) || (node.parentKey !== null && !text(node.parentKey)) || keys.has(node.sourceKey)) {
      throw new Error('剧情节点无效、sourceKey 重复或剧情线不存在');
    }
    keys.add(node.sourceKey);
    return { sourceKey: node.sourceKey, title: node.title, storyLineId: node.storyLineId, parentKey: node.parentKey as string | null, order: node.order, ...(node.releasedAt !== undefined ? { releasedAt: node.releasedAt as string | null } : {}),
      ...(node.sourceUrl !== undefined ? { sourceUrl: node.sourceUrl as string | null } : {}) };
  });
  const byKey = new Map(nodes.map(node => [node.sourceKey, node]));
  for (const node of nodes) {
    let cur = node;
    const path = new Set<string>();
    while (true) {
      if (path.has(cur.sourceKey) || path.size >= 256) throw new Error('剧情树存在循环或超过 256 层');
      path.add(cur.sourceKey);
      if (cur.parentKey === null) break;
      const parent = byKey.get(cur.parentKey);
      if (!parent || parent.storyLineId !== node.storyLineId) throw new Error('父节点不存在或跨越剧情线');
      cur = parent;
    }
  }
  if (storyLines.some(line => !nodes.some(node => node.storyLineId === line.id))) throw new Error('剧情线不能没有节点');
  return { ...(raw.importerId !== undefined ? { importerId: raw.importerId as string | null } : {}), game: { id: game.id, title: game.title }, storyLines, nodes };
}

export function parseImportResult(value: unknown): ImportResult {
  const raw = object(value);
  if ('catalog' in raw) {
    fields(raw, ['apiVersion', 'catalog'], ['warnings']);
    if (raw.apiVersion !== 1) throw new Error('不支持的导入模块协议版本');
    const warnings = raw.warnings ?? [];
    if (!Array.isArray(warnings) || warnings.length > 10000 || warnings.some(item => typeof item !== 'string' || item.length > 4000)) throw new Error('导入模块提示无效');
    return { apiVersion: 1, catalog: parseCatalog(raw.catalog), warnings };
  }
  return { apiVersion: 1, catalog: parseCatalog(raw), warnings: [] };
}
