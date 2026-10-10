import type { ExplorerUrlParams } from '@opsgraph/shared';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { ExplorerToolbar } from './ExplorerToolbar';

afterEach(cleanup);

const DEFAULTS: ExplorerUrlParams = {
  direction: 'all',
  depth: 2,
  relationshipTypes: [],
  entityTypes: [],
  blockers: false,
};

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{`${location.pathname}${location.search}`}</p>;
}

function renderToolbar(url: string, params: ExplorerUrlParams = DEFAULTS) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ExplorerToolbar params={params} />
      <LocationProbe />
    </MemoryRouter>,
  );
}

const locationText = () => screen.getByTestId('location').textContent;

describe('ExplorerToolbar Highlight blockers', () => {
  it('is unchecked by default and reflects the current setting', () => {
    renderToolbar('/graph/x');
    expect(screen.getByRole('checkbox', { name: 'Highlight blockers' })).not.toBeChecked();
    cleanup();
    renderToolbar('/graph/x?blockers=true', { ...DEFAULTS, blockers: true });
    expect(screen.getByRole('checkbox', { name: 'Highlight blockers' })).toBeChecked();
  });

  it('writes blockers=true when checked and removes the param when unchecked', async () => {
    renderToolbar('/graph/x?depth=3');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Highlight blockers' }));
    expect(locationText()).toBe('/graph/x?depth=3&blockers=true');
    cleanup();

    renderToolbar('/graph/x?blockers=true&depth=3', { ...DEFAULTS, depth: 3, blockers: true });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Highlight blockers' }));
    expect(locationText()).toBe('/graph/x?depth=3');
  });
});

describe('ExplorerToolbar steps', () => {
  it('offers 1 to 4 steps and shows the current value', () => {
    renderToolbar('/graph/x');
    const select = screen.getByRole('combobox', { name: 'Steps' });
    expect(Array.from((select as HTMLSelectElement).options).map((o) => o.value)).toEqual([
      '1',
      '2',
      '3',
      '4',
    ]);
    expect(select).toHaveValue('2');
  });

  it('writes a non-default step limit to the URL and keeps other params', async () => {
    renderToolbar('/graph/x?blockers=true');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Steps' }), '4');
    expect(locationText()).toBe('/graph/x?blockers=true&depth=4');
  });

  it('omits the default from the URL', async () => {
    renderToolbar('/graph/x?depth=4', { ...DEFAULTS, depth: 4 });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Steps' }), '2');
    expect(locationText()).toBe('/graph/x');
  });
});
