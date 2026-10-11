import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { GraphLegend } from './GraphLegend';

afterEach(cleanup);

describe('GraphLegend', () => {
  it('explains every origin, confidence and relationship style (FR-010)', () => {
    render(<GraphLegend />);
    const legend = screen.getByLabelText('Legend');
    for (const text of [
      'Source (solid)',
      'Inferred (dashed)',
      'Manual (dotted)',
      'High / Medium / Low confidence (thicker → thinner)',
      'Relates to (grey, no arrow)',
      'Blocking path (red)',
    ]) {
      expect(within(legend).getByText(text)).toBeInTheDocument();
    }
  });

  it('explains every node marker', () => {
    render(<GraphLegend />);
    const legend = screen.getByLabelText('Legend');
    for (const text of [
      'Focus',
      'Connector',
      'Conflict',
      'State unknown',
      'Direct blocker',
      'Deepest blocker',
    ]) {
      expect(within(legend).getByText(text)).toBeInTheDocument();
    }
  });

  it('draws the origin samples with the styles the edges use', () => {
    const { container } = render(<GraphLegend />);
    const dashes = Array.from(container.querySelectorAll('line')).map((line) =>
      line.getAttribute('stroke-dasharray'),
    );
    expect(dashes).toContain('8 4');
    expect(dashes).toContain('2 4');
    expect(dashes).toContain(null);
  });
});
