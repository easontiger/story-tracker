import { describe, expect, it } from 'vitest';
import { buildTree, treeStats, sortTreeByDate, buildTimeline, searchTree } from '../src/tree';
import type { StoryNode } from '../src/types';

function node(id: string, parentId: string | null, order: number, watched = false): StoryNode {
  return { id, parentId, order, watchedAt: watched ? '2026-10-03T00:00:00Z' : null,
    gameId: 'game', storyLineId: 'main', sourceKey: id, title: id, active: true };
}

describe('tree progress statistics', () => {
  it('counts only leaves across different depths and out-of-order progress', () => {
    const tree = buildTree([node('ch', null, 0, true), node('first', 'ch', 0),
      node('section', 'ch', 1), node('last', 'section', 0, true), node('extra', null, 1, true)]);
    expect(treeStats(tree)).toEqual({ watched: 2, total: 3 });
    expect(tree[0].children.map(child => child.node.id)).toEqual(['first', 'section']);
    expect(tree[0].watched).toBe(1);
  });

  it('rejects an unreachable cycle or missing parent rather than omitting progress', () => {
    expect(() => buildTree([node('a', 'b', 0), node('b', 'a', 0)])).toThrow();
    expect(() => buildTree([node('a', 'missing', 0)])).toThrow();
  });
});

describe('chronological story views', () => {
  function dated(id: string, parent: string | null, order: number, day: string | null, watched = false) {
    return { ...node(id, parent, order, watched), releasedAt: day };
  }

  it('mixes projects across categories, keeps same-day order and places unknown dates last', () => {
    const main = buildTree([
      node('main-category', null, 0),
      dated('late', 'main-category', 0, '2024-03-01'),
      node('late-stage', 'late', 0, true),
      dated('same', 'main-category', 1, '2024-02-01'),
      node('same-stage', 'same', 0),
      node('unknown', 'main-category', 2),
      node('unknown-stage', 'unknown', 0),
    ]);
    const events = buildTree([
      dated('early', null, 0, '2024-01-01T12:00:00Z'),
      node('early-stage', 'early', 0),
      dated('same-event', null, 1, '2024-02-01'),
      node('same-event-stage', 'same-event', 0),
    ]);
    const timeline = buildTimeline([{ title: 'Main', tree: main }, { title: 'Events', tree: events }]);
    expect(timeline.map(item => item.entry.node.id)).toEqual(['early', 'same', 'same-event', 'late', 'unknown']);
    expect(timeline.find(item => item.entry.node.id === 'late')?.category).toBe('Main / main-category');
    expect(treeStats(timeline.map(item => item.entry))).toEqual({ watched: 1, total: 5 });
    expect(main[0].children[0].node.id).toBe('late');
  });

  it('sorts within categories without changing chapter stage order or source trees', () => {
    const tree = buildTree([
      node('category', null, 0),
      dated('later', 'category', 0, '2024-02-02'),
      dated('first-stage', 'later', 0, '2024-02-03'),
      dated('second-stage', 'later', 1, '2024-02-02', true),
      dated('earlier', 'category', 1, '2024-01-01'),
      node('earlier-stage', 'earlier', 0),
    ]);
    const sorted = sortTreeByDate(tree);
    expect(sorted[0].children.map(item => item.node.id)).toEqual(['earlier', 'later']);
    expect(sorted[0].children[1].children.map(item => item.node.id)).toEqual(['first-stage', 'second-stage']);
    expect(tree[0].children.map(item => item.node.id)).toEqual(['later', 'earlier']);
    expect(treeStats(sorted)).toEqual(treeStats(tree));
  });

  it('keeps nested chapters intact and includes standalone stages without duplicating progress', () => {
    const tree = buildTree([
      node('category', null, 0), node('sub-category', 'category', 0),
      dated('chapter', 'sub-category', 0, '2024-01-01'),
      node('section', 'chapter', 0), node('stage', 'section', 0, true),
      dated('standalone', null, 1, '2024-02-01'),
    ]);
    const timeline = buildTimeline([{ title: 'Main', tree }]);
    expect(timeline.map(item => item.entry.node.id)).toEqual(['chapter', 'standalone']);
    expect(timeline[0].entry.children[0].children[0].node.id).toBe('stage');
    expect(treeStats(timeline.map(item => item.entry))).toEqual(treeStats(tree));
  });
});

it('preserves major category order while sorting the projects inside each category', () => {
  const tree = buildTree([
    node('main', null, 0), { ...node('chapter', 'main', 0), releasedAt: '2024-05-01' },
    node('stage', 'chapter', 0),
    node('events', null, 1), { ...node('event', 'events', 0), releasedAt: '2024-01-01' },
    node('event-stage', 'event', 0),
  ]);
  expect(sortTreeByDate(tree).map(entry => entry.node.id)).toEqual(['main', 'events']);
  expect(buildTimeline([{ title: 'Game', tree }]).map(item => item.entry.node.id)).toEqual(['event', 'chapter']);
});

describe('story search', () => {
  it('keeps ancestors and original progress while matching story names without case sensitivity', () => {
    const tree = buildTree([node('chapter', null, 0), node('Target story', 'chapter', 0, true),
      node('other', 'chapter', 1), node('unrelated', null, 1)]);
    const found = searchTree(tree, '  TARGET  ');
    expect(found).toHaveLength(1);
    expect(found[0].children.map(n => n.node.id)).toEqual(['Target story']);
    expect(found[0].total).toBe(2);
    expect(found[0].watched).toBe(1);
    expect(tree[0].children).toHaveLength(2);
    expect(searchTree(tree, 'missing')).toEqual([]);
    expect(searchTree(tree, '')).toBe(tree);
  });
  it('matches whole chapters while combining watched filters without empty or false leaf directories', () => {
    const tree = buildTree([node('chapter', null, 0), node('seen', 'chapter', 0, true),
      node('new', 'chapter', 1)]);
    expect(searchTree(tree, 'chapter')[0].children).toHaveLength(2);
    expect(searchTree(tree, 'chapter', 'unwatched')[0].children.map(n => n.node.id)).toEqual(['new']);
    expect(searchTree(tree, 'seen', 'unwatched')).toEqual([]);
    expect(searchTree(tree, 'chapter', 'watched')[0].children.map(n => n.node.id)).toEqual(['seen']);
  });
});
