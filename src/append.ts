import { parseCatalog } from './catalog';
import type { Snapshot, StoryCatalog, StoryNode } from './types';

export interface AppendDraft {
  gameId: string; lineId: string; parentId: string | null;
  title: string; stories: string; releasedAt: string;
}

export function createAppendCatalog(snapshot: Snapshot, draft: AppendDraft, token: string): StoryCatalog {
  const game = snapshot.games.find(item => item.id === draft.gameId);
  const line = snapshot.storyLines.find(item => item.gameId === draft.gameId && item.id === draft.lineId);
  if (!game || !line) throw new Error('请选择游戏和分类');
  const existing = snapshot.nodes.filter(node => node.active && node.gameId === game.id && node.storyLineId === line.id);
  const nodes: StoryCatalog['nodes'] = [];
  let parent: StoryNode | undefined;
  if (draft.parentId !== null) {
    parent = existing.find(node => node.id === draft.parentId);
    if (!parent || !existing.some(node => node.parentId === parent!.id)) throw new Error('请选择已有目录，不能在剧情下添加');
    const seen = new Set<string>();
    let ancestor: StoryNode | undefined = parent;
    while (ancestor) {
      if (seen.has(ancestor.id)) throw new Error('目录层级异常');
      seen.add(ancestor.id);
      nodes.unshift({
        sourceKey: ancestor.sourceKey, storyLineId: line.id,
        parentKey: ancestor.parentId === null ? null : existing.find(node => node.id === ancestor!.parentId)?.sourceKey ?? null,
        title: ancestor.title, order: ancestor.order,
        releasedAt: ancestor.releasedAt ?? null, sourceUrl: ancestor.sourceUrl ?? null,
      });
      if (ancestor.parentId === null) break;
      ancestor = existing.find(node => node.id === ancestor!.parentId);
      if (!ancestor) throw new Error('上级目录不存在');
    }
  }
  const stories = draft.stories.split(/\r?\n/).map(title => title.trim()).filter(Boolean);
  if (!stories.length || !draft.title.trim()) throw new Error('请填写活动名称和剧情列表');
  const key = 'manual:' + token;
  const order = Math.max(-1, ...existing.filter(node => node.parentId === draft.parentId).map(node => node.order)) + 1;
  nodes.push({ sourceKey: key, storyLineId: line.id, parentKey: parent?.sourceKey ?? null,
    title: draft.title.trim(), order, releasedAt: draft.releasedAt || null });
  stories.forEach((title, index) => nodes.push({ sourceKey: key + '/' + (index + 1),
    storyLineId: line.id, parentKey: key, title, order: index, releasedAt: draft.releasedAt || null }));
  return parseCatalog({ importerId: game.importerId, game: { id: game.id, title: game.title },
    storyLines: [{ id: line.id, title: line.title, order: line.order }], nodes });
}
