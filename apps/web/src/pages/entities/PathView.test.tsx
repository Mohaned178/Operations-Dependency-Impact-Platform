import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { PathView } from './PathView';
import { F1_BLOCKERS, PAY_ID, SHIPMENT } from './tracing-test-data';

function renderPath(index: number, direction: 'upstream' | 'downstream' = 'upstream') {
  const path = F1_BLOCKERS.paths[index];
  if (path === undefined) {
    throw new Error('missing fixture path');
  }
  return render(
    <MemoryRouter>
      <PathView start={SHIPMENT} path={path} direction={direction} />
    </MemoryRouter>,
  );
}

/** The first paragraph of each top-level hop item. */
function hopHeaders(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(':scope > ol > li > p:first-child'));
}

describe('PathView', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders a REVERSE BLOCKS hop as it was recorded, with the manual badge', () => {
    const { container } = renderPath(1);

    const header = hopHeaders(container)[0];
    if (header === undefined) {
      throw new Error('expected a first hop');
    }
    expect(
      within(header).getByText('Payment PAY-88213 BLOCKS Shipment SHP-77120 (consolidated)'),
    ).toBeInTheDocument();
    expect(within(header).getByText('Manual · MEDIUM')).toBeInTheDocument();
  });

  it('renders one item per hop with a link, a state badge and an evidence disclosure', () => {
    const { container } = renderPath(0);

    expect(hopHeaders(container)).toHaveLength(4);
    expect(screen.getByRole('link', { name: 'Order #18492' })).toHaveAttribute(
      'href',
      '/entities/22222222-2222-4222-8222-222222222222',
    );
    expect(screen.getByRole('link', { name: 'Payment PAY-88213' })).toHaveAttribute(
      'href',
      `/entities/${PAY_ID}`,
    );
    expect(
      screen.getByText('Shipment SHP-77120 (consolidated) DEPENDS_ON Order #18492'),
    ).toBeInTheDocument();
    expect(
      hopHeaders(container).every((header) => within(header).queryByText('Source · HIGH') !== null),
    ).toBe(true);
    expect(screen.getAllByText('Evidence')).toHaveLength(4);
    expect(screen.getAllByText('Evidence')[0]?.closest('details')).not.toBeNull();
  });

  it('uses an up arrow upstream and a down arrow downstream', () => {
    const { container, unmount } = renderPath(0, 'upstream');
    expect(container.textContent).toContain('↑');
    expect(container.textContent).not.toContain('↓');
    unmount();

    const downstream = renderPath(0, 'downstream');
    expect(downstream.container.textContent).toContain('↓');
    expect(downstream.container.textContent).not.toContain('↑');
  });
});
