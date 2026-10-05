import { describe, expect, it } from 'vitest';
import fixture from '../importers/mock/catalog.json';
import { createAppendCatalog, type AppendDraft } from '../src/append';
import type { Snapshot } from '../src/types';

const snapshot: Snapshot = {
  revision: 1, games: [fixture.game],
  storyLines: fixture.storyLines.map(line => ({ ...line, gameId: fixture.game.id })),
  nodes: fixture.nodes.map(node => ({ ...node, id: node.sourceKey, gameId: fixture.game.id,
    parentId: node.parentKey, active: true, watchedAt: null })),
  orphanedProgress: [],
};
const draft: AppendDraft = { gameId: 'mock-game', lineId: 'event', parentId: null,
  title: '新活动', stories: '序章\r\n\n 第一话 \n终章', releasedAt: '2026-10-04' };

describe('manual incremental catalog', () => {
  it('creates only the new activity, preserves line metadata and stable keys for export/reimport', () => {
    const patch = createAppendCatalog(snapshot, draft, 'fixed-token');
    expect(patch.nodes.map(node => node.title)).toEqual(['新活动', '序章', '第一话', '终章']);
    expect(patch.nodes[0].order).toBe(2);
    expect(patch.nodes.every(node => node.releasedAt === '2026-10-04')).toBe(true);
    expect(patch.storyLines).toEqual([fixture.storyLines[1]]);
    expect(createAppendCatalog(snapshot, draft, 'fixed-token')).toEqual(patch);
    expect(snapshot.nodes).toHaveLength(9);
  });
  it('includes exact ancestor references when adding below an existing directory', () => {
    const patch = createAppendCatalog(snapshot, { ...draft, parentId: 'event/summer' }, 'nested');
    expect(patch.nodes[0]).toMatchObject({ sourceKey: 'event/summer', parentKey: null, title: '夏日篇', order: 0 });
    expect(patch.nodes[1]).toMatchObject({ parentKey: 'event/summer', order: 2 });
  });
  it('rejects leaf parents, wrong categories, empty stories and impossible dates', () => {
    for (const changes of [{ parentId: 'event/extra' }, { parentId: 'main/ch1' },
      { lineId: 'missing' }, { stories: '\n  ' }, { title: ' ' }, { releasedAt: '2026-02-30' }]) {
      expect(() => createAppendCatalog(snapshot, { ...draft, ...changes }, 'bad')).toThrow();
    }
  });
});
