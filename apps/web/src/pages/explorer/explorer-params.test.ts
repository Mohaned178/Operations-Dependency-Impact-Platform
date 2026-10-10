import type { ExplorerUrlParams } from '@opsgraph/shared';
import { describe, expect, it } from 'vitest';
import {
  parseExplorerParams,
  toNeighborhoodQueryString,
  writeExplorerParams,
} from './explorer-params';

const A = '6f1b3c2a-4d5e-4f60-8a9b-1c2d3e4f5a6b';
const B = '7a2c4d3b-5e6f-4071-9b0c-2d3e4f5a6b7c';

describe('parseExplorerParams', () => {
  it('parses defaults from an empty query', () => {
    expect(parseExplorerParams(new URLSearchParams())).toEqual({
      ok: true,
      params: {
        direction: 'all',
        depth: 2,
        relationshipTypes: [],
        entityTypes: [],
        blockers: false,
      },
    });
  });

  it('round-trips a full state through the URL', () => {
    const parsed = parseExplorerParams(
      new URLSearchParams(
        'direction=downstream&depth=4&relationshipTypes=REQUIRES,BLOCKS&entityTypes=Order,Shipment&blockers=true',
      ),
    );
    expect(parsed).toEqual({
      ok: true,
      params: {
        direction: 'downstream',
        depth: 4,
        relationshipTypes: ['REQUIRES', 'BLOCKS'],
        entityTypes: ['Order', 'Shipment'],
        blockers: true,
      },
    });
    if (!parsed.ok) {
      throw new Error('expected ok');
    }
    const written = writeExplorerParams(new URLSearchParams(), parsed.params);
    expect(parseExplorerParams(written)).toEqual(parsed);
  });

  it('reports invalid values instead of falling back to defaults', () => {
    const result = parseExplorerParams(new URLSearchParams('depth=9&direction=sideways&entityTypes=Foo'));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.some((i) => i.startsWith('depth:'))).toBe(true);
    expect(result.issues.some((i) => i.startsWith('direction:'))).toBe(true);
    expect(result.issues.some((i) => i.startsWith('entityTypes'))).toBe(true);
  });

  it('reports RELATES_TO with upstream as an issue', () => {
    const result = parseExplorerParams(
      new URLSearchParams('direction=upstream&relationshipTypes=RELATES_TO'),
    );
    expect(result).toEqual({
      ok: false,
      issues: ['relationshipTypes: RELATES_TO is only allowed when direction is all'],
    });
  });

  it('ignores an expand param (it is not a URL setting)', () => {
    const result = parseExplorerParams(new URLSearchParams(`expand=${A}`));
    expect(result.ok).toBe(true);
  });
});

describe('writeExplorerParams', () => {
  it('omits defaults', () => {
    const written = writeExplorerParams(
      new URLSearchParams('direction=upstream&depth=4&relationshipTypes=REQUIRES&entityTypes=Order&blockers=true'),
      { direction: 'all', depth: 2, relationshipTypes: [], entityTypes: [], blockers: false },
    );
    expect(written.toString()).toBe('');
  });

  it('keeps unrelated params and untouched settings', () => {
    const written = writeExplorerParams(new URLSearchParams('foo=bar&depth=3'), {
      direction: 'upstream',
    });
    expect(written.get('foo')).toBe('bar');
    expect(written.get('depth')).toBe('3');
    expect(written.get('direction')).toBe('upstream');
  });

  it('writes lists comma-joined and blockers as true', () => {
    const written = writeExplorerParams(new URLSearchParams(), {
      relationshipTypes: ['REQUIRES', 'BLOCKS'],
      entityTypes: ['Order'],
      blockers: true,
    });
    expect(written.get('relationshipTypes')).toBe('REQUIRES,BLOCKS');
    expect(written.get('entityTypes')).toBe('Order');
    expect(written.get('blockers')).toBe('true');
  });
});

describe('toNeighborhoodQueryString', () => {
  const base: ExplorerUrlParams = {
    direction: 'all',
    depth: 2,
    relationshipTypes: [],
    entityTypes: [],
    blockers: false,
  };

  it('sends the settings and omits empty lists and expand', () => {
    expect(toNeighborhoodQueryString(base, [])).toBe('direction=all&depth=2&blockers=false');
  });

  it('adds non-empty lists and keeps expand in the given order', () => {
    const query = new URLSearchParams(
      toNeighborhoodQueryString(
        { ...base, direction: 'downstream', relationshipTypes: ['REQUIRES'], entityTypes: ['Order', 'Shipment'], blockers: true },
        [B, A],
      ),
    );
    expect(query.get('direction')).toBe('downstream');
    expect(query.get('relationshipTypes')).toBe('REQUIRES');
    expect(query.get('entityTypes')).toBe('Order,Shipment');
    expect(query.get('blockers')).toBe('true');
    expect(query.get('expand')).toBe(`${B},${A}`);
  });
});
