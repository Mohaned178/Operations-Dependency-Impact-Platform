import { MarkerType, type EdgeMarker } from '@xyflow/react';
import type {
  Confidence,
  GraphEdgeDto,
  RelationshipOrigin,
  RelationshipType,
} from '@opsgraph/shared';
import { describe, expect, it } from 'vitest';
import { edgeStyle } from './edge-style';
import type { Emphasis } from './flow-types';

function makeEdge(
  overrides: Partial<
    Pick<GraphEdgeDto, 'relationshipType' | 'effectiveOrigin' | 'effectiveConfidence'>
  >,
): GraphEdgeDto {
  return {
    key: '00000000-0000-4000-8000-000000000001',
    relationshipType: overrides.relationshipType ?? 'REQUIRES',
    fromEntityId: '00000000-0000-4000-8000-000000000002',
    toEntityId: '00000000-0000-4000-8000-000000000003',
    effectiveOrigin: overrides.effectiveOrigin ?? 'SOURCE',
    effectiveConfidence: overrides.effectiveConfidence ?? 'HIGH',
    assertions: [
      {
        relationshipId: '00000000-0000-4000-8000-000000000001',
        origin: 'SOURCE',
        confidence: 'HIGH',
        basis: null,
        sourceSystem: 'erp',
        sourceId: 'REQ-1',
        observedAt: '2026-01-01T00:00:00.000Z',
        importId: '00000000-0000-4000-8000-000000000004',
      },
    ],
  };
}

const ORIGIN_LABEL: Record<RelationshipOrigin, string> = {
  SOURCE: 'Source',
  INFERRED: 'Inferred',
  MANUAL: 'Manual',
};

const ORIGINS: RelationshipOrigin[] = ['SOURCE', 'INFERRED', 'MANUAL'];
const CONFIDENCES: Confidence[] = ['HIGH', 'MEDIUM', 'LOW'];
const EMPHASES: Emphasis[] = ['normal', 'highlighted', 'dimmed'];

function arrowFor(color: string): EdgeMarker {
  return { type: MarkerType.ArrowClosed, width: 14, height: 14, color };
}

describe('edgeStyle', () => {
  describe('stroke dash by origin', () => {
    it.each([
      ['SOURCE', undefined],
      ['INFERRED', '8 4'],
      ['MANUAL', '2 4'],
    ] as const)('%s uses dasharray %s', (origin, dash) => {
      expect(
        edgeStyle(makeEdge({ effectiveOrigin: origin }), 'normal', false).strokeDasharray,
      ).toBe(dash);
    });
  });

  describe('stroke width by confidence', () => {
    it.each([
      ['HIGH', 2.5],
      ['MEDIUM', 1.75],
      ['LOW', 1],
    ] as const)('%s is %d when not emphasized', (confidence, width) => {
      expect(
        edgeStyle(makeEdge({ effectiveConfidence: confidence }), 'normal', false).strokeWidth,
      ).toBe(width);
    });

    it.each(CONFIDENCES)('%s gets +1 when selected or highlighted', (confidence) => {
      const base = edgeStyle(makeEdge({ effectiveConfidence: confidence }), 'normal', false);
      const selected = edgeStyle(makeEdge({ effectiveConfidence: confidence }), 'normal', true);
      const highlighted = edgeStyle(
        makeEdge({ effectiveConfidence: confidence }),
        'highlighted',
        false,
      );
      expect(selected.strokeWidth).toBe(base.strokeWidth + 1);
      expect(highlighted.strokeWidth).toBe(base.strokeWidth + 1);
    });

    it('dimmed does not add width', () => {
      expect(
        edgeStyle(makeEdge({ effectiveConfidence: 'HIGH' }), 'dimmed', false).strokeWidth,
      ).toBe(2.5);
    });
  });

  describe('opacity', () => {
    it('dimmed is 0.15 for every origin and confidence', () => {
      for (const origin of ORIGINS) {
        for (const confidence of CONFIDENCES) {
          const visual = edgeStyle(
            makeEdge({ effectiveOrigin: origin, effectiveConfidence: confidence }),
            'dimmed',
            false,
          );
          expect(visual.opacity).toBe(0.15);
        }
      }
    });

    it('LOW is 0.7 when not dimmed, other confidences are 1', () => {
      expect(edgeStyle(makeEdge({ effectiveConfidence: 'LOW' }), 'normal', false).opacity).toBe(
        0.7,
      );
      expect(edgeStyle(makeEdge({ effectiveConfidence: 'LOW' }), 'highlighted', true).opacity).toBe(
        0.7,
      );
      expect(edgeStyle(makeEdge({ effectiveConfidence: 'MEDIUM' }), 'normal', false).opacity).toBe(
        1,
      );
      expect(edgeStyle(makeEdge({ effectiveConfidence: 'HIGH' }), 'normal', false).opacity).toBe(1);
    });

    it('dimmed wins over LOW', () => {
      expect(edgeStyle(makeEdge({ effectiveConfidence: 'LOW' }), 'dimmed', false).opacity).toBe(
        0.15,
      );
    });
  });

  describe('stroke colour', () => {
    it('is slate for a plain edge', () => {
      expect(edgeStyle(makeEdge({}), 'normal', false).stroke).toBe('#64748b');
    });

    it('is blue when selected, and selection wins over highlight', () => {
      expect(edgeStyle(makeEdge({}), 'normal', true).stroke).toBe('#2563eb');
      expect(edgeStyle(makeEdge({}), 'highlighted', true).stroke).toBe('#2563eb');
    });

    it('is red when highlighted and not selected', () => {
      expect(edgeStyle(makeEdge({}), 'highlighted', false).stroke).toBe('#dc2626');
    });

    it('is grey for RELATES_TO unless highlighted or selected', () => {
      const relates = makeEdge({ relationshipType: 'RELATES_TO' });
      expect(edgeStyle(relates, 'normal', false).stroke).toBe('#94a3b8');
      expect(edgeStyle(relates, 'dimmed', false).stroke).toBe('#94a3b8');
      expect(edgeStyle(relates, 'highlighted', false).stroke).toBe('#dc2626');
      expect(edgeStyle(relates, 'normal', true).stroke).toBe('#2563eb');
    });
  });

  describe('marker', () => {
    it('RELATES_TO has no marker', () => {
      for (const emphasis of EMPHASES) {
        for (const selected of [true, false]) {
          expect(
            edgeStyle(makeEdge({ relationshipType: 'RELATES_TO' }), emphasis, selected).marker,
          ).toBeUndefined();
        }
      }
    });

    it('other types get an ArrowClosed marker coloured like the stroke', () => {
      const plain = edgeStyle(makeEdge({ relationshipType: 'BLOCKS' }), 'normal', false);
      expect(plain.marker).toEqual(arrowFor('#64748b'));
      expect(plain.marker).toEqual(arrowFor(plain.stroke));

      const highlighted = edgeStyle(makeEdge({ relationshipType: 'BLOCKS' }), 'highlighted', false);
      expect(highlighted.marker).toEqual(arrowFor('#dc2626'));

      const selected = edgeStyle(makeEdge({ relationshipType: 'BLOCKS' }), 'normal', true);
      expect(selected.marker).toEqual(arrowFor('#2563eb'));
    });
  });

  describe('labels', () => {
    it.each(
      ORIGINS.flatMap((origin) => CONFIDENCES.map((confidence) => [origin, confidence] as const)),
    )('unselected %s / %s reads "<Origin> · <confidence>"', (origin, confidence) => {
      const visual = edgeStyle(
        makeEdge({ effectiveOrigin: origin, effectiveConfidence: confidence }),
        'normal',
        false,
      );
      expect(visual.label).toBe(`${ORIGIN_LABEL[origin]} · ${confidence}`);
    });

    it.each(
      ORIGINS.flatMap((origin) => CONFIDENCES.map((confidence) => [origin, confidence] as const)),
    )('selected %s / %s prefixes the relationship type', (origin, confidence) => {
      const visual = edgeStyle(
        makeEdge({
          relationshipType: 'DEPENDS_ON',
          effectiveOrigin: origin,
          effectiveConfidence: confidence,
        }),
        'normal',
        true,
      );
      expect(visual.label).toBe(`DEPENDS_ON · ${ORIGIN_LABEL[origin]} · ${confidence}`);
    });

    it('uses the exact example text', () => {
      expect(
        edgeStyle(
          makeEdge({ effectiveOrigin: 'SOURCE', effectiveConfidence: 'HIGH' }),
          'normal',
          false,
        ).label,
      ).toBe('Source · HIGH');
      expect(
        edgeStyle(
          makeEdge({ effectiveOrigin: 'INFERRED', effectiveConfidence: 'MEDIUM' }),
          'normal',
          false,
        ).label,
      ).toBe('Inferred · MEDIUM');
    });

    it('uses the relationship type in the selected label', () => {
      const types: RelationshipType[] = ['HAS', 'BLOCKS', 'RELATES_TO'];
      for (const relationshipType of types) {
        expect(
          edgeStyle(makeEdge({ relationshipType, effectiveOrigin: 'MANUAL' }), 'normal', true)
            .label,
        ).toBe(`${relationshipType} · Manual · HIGH`);
      }
    });
  });

  describe('showLabel', () => {
    it('is false for an unselected SOURCE edge', () => {
      expect(edgeStyle(makeEdge({ effectiveOrigin: 'SOURCE' }), 'normal', false).showLabel).toBe(
        false,
      );
    });

    it('is true for INFERRED and MANUAL edges even when not selected', () => {
      expect(edgeStyle(makeEdge({ effectiveOrigin: 'INFERRED' }), 'normal', false).showLabel).toBe(
        true,
      );
      expect(edgeStyle(makeEdge({ effectiveOrigin: 'MANUAL' }), 'normal', false).showLabel).toBe(
        true,
      );
    });

    it('is true when selected, whatever the origin', () => {
      expect(edgeStyle(makeEdge({ effectiveOrigin: 'SOURCE' }), 'normal', true).showLabel).toBe(
        true,
      );
    });

    it('is true when selected and dimmed or highlighted', () => {
      expect(edgeStyle(makeEdge({ effectiveOrigin: 'SOURCE' }), 'dimmed', true).showLabel).toBe(
        true,
      );
      expect(
        edgeStyle(makeEdge({ effectiveOrigin: 'SOURCE' }), 'highlighted', true).showLabel,
      ).toBe(true);
    });
  });
});
