import { describe, expect, it } from 'vitest';
import fixture from '../importers/mock/catalog.json';
import { parseCatalog, parseImportResult } from '../src/catalog';

describe('catalog import boundary', () => {
  it('accepts an external module envelope and a standalone catalog file', () => {
    expect(parseImportResult({ apiVersion: 1, catalog: fixture, warnings: ['No date'] }).catalog).toEqual(fixture);
    expect(parseImportResult(fixture).warnings).toEqual([]);
    expect(() => parseImportResult({ apiVersion: 2, catalog: fixture })).toThrow();
    expect(() => parseImportResult({ apiVersion: 1, catalog: fixture, warnings: [4] })).toThrow();
  });

  it('accepts optional source/date metadata while rejecting unknown or invalid fields', () => {
    const raw = structuredClone(fixture);
    Object.assign(raw.nodes[0], { releasedAt: '2019-05-30T16:00:00+08:00', sourceUrl: 'https://prts.wiki/w/Example' });
    expect(parseCatalog(raw).nodes[0].releasedAt).toBe('2019-05-30T16:00:00+08:00');
    Object.assign(raw.nodes[0], { releasedAt: 'not a date' });
    expect(() => parseCatalog(raw)).toThrow();
  });

  it('accepts calendar dates and rejects impossible or unpadded dates', () => {
    const raw = structuredClone(fixture);
    Object.assign(raw.nodes[0], { releasedAt: '2024-02-29' });
    expect(parseCatalog(raw).nodes[0].releasedAt).toBe('2024-02-29');
    for (const releasedAt of ['2023-02-29', '2024-02-30', '2024-2-29', '2024-13-01']) {
      Object.assign(raw.nodes[0], { releasedAt });
      expect(() => parseCatalog(raw)).toThrow();
    }
  });

  it.each(['duplicate', 'missing-parent', 'cycle', 'cross-line', 'unknown-field', 'fractional-order', 'empty-title'])('rejects invalid input: %s', problem => {
    const raw = structuredClone(fixture);
    switch (problem) {
      case 'duplicate': raw.nodes.push(raw.nodes[0]); break;
      case 'missing-parent': raw.nodes[1].parentKey = 'missing'; break;
      case 'cycle': raw.nodes[0].parentKey = raw.nodes[1].sourceKey; break;
      case 'cross-line': raw.nodes[1].parentKey = 'event/summer'; break;
      case 'unknown-field': Object.assign(raw.nodes[0], { surprise: 'x' }); break;
      case 'fractional-order': raw.nodes[0].order = .5; break;
      case 'empty-title': raw.nodes[0].title = ' '; break;
    }
    expect(() => parseCatalog(raw)).toThrow();
  });
});
