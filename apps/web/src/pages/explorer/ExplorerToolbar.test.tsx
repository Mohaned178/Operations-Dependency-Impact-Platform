import type { ExplorerUrlParams } from '@opsgraph/shared';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
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

describe('ExplorerToolbar direction', () => {
  it('shows three radios with the current direction checked', () => {
    renderToolbar('/graph/x?direction=upstream', { ...DEFAULTS, direction: 'upstream' });
    const group = screen.getByRole('radiogroup', { name: 'Direction' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'All directions' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: 'Upstream only' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Downstream only' })).toHaveAttribute('aria-checked', 'false');
  });

  it('writes the direction to the URL and omits the default', async () => {
    renderToolbar('/graph/x');
    await userEvent.click(screen.getByRole('radio', { name: 'Downstream only' }));
    expect(locationText()).toBe('/graph/x?direction=downstream');
    cleanup();

    renderToolbar('/graph/x?direction=downstream', { ...DEFAULTS, direction: 'downstream' });
    await userEvent.click(screen.getByRole('radio', { name: 'All directions' }));
    expect(locationText()).toBe('/graph/x');
  });

  it('removes RELATES_TO from the relationship filter when switching to upstream', async () => {
    renderToolbar('/graph/x?relationshipTypes=REQUIRES,RELATES_TO', {
      ...DEFAULTS,
      relationshipTypes: ['REQUIRES', 'RELATES_TO'],
    });
    await userEvent.click(screen.getByRole('radio', { name: 'Upstream only' }));
    expect(locationText()).toBe('/graph/x?relationshipTypes=REQUIRES&direction=upstream');
  });

  it('drops the relationship filter when only RELATES_TO was selected', async () => {
    renderToolbar('/graph/x?relationshipTypes=RELATES_TO', {
      ...DEFAULTS,
      relationshipTypes: ['RELATES_TO'],
    });
    await userEvent.click(screen.getByRole('radio', { name: 'Downstream only' }));
    expect(locationText()).toBe('/graph/x?direction=downstream');
  });
});

describe('ExplorerToolbar radiogroup keyboard', () => {
  it('makes only the checked radio a Tab stop', () => {
    renderToolbar('/graph/x?direction=upstream', { ...DEFAULTS, direction: 'upstream' });
    expect(screen.getByRole('radio', { name: 'Upstream only' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: 'All directions' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('radio', { name: 'Downstream only' })).toHaveAttribute('tabindex', '-1');
  });

  it('moves and checks the next radio with the arrow keys, wrapping around', async () => {
    renderToolbar('/graph/x');
    screen.getByRole('radio', { name: 'All directions' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(locationText()).toBe('/graph/x?direction=upstream');
    expect(screen.getByRole('radio', { name: 'Upstream only' })).toHaveFocus();

    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    // upstream -> all (omitted from the URL) -> wraps to downstream
    expect(locationText()).toBe('/graph/x?direction=downstream');
    expect(screen.getByRole('radio', { name: 'Downstream only' })).toHaveFocus();
  });
});

describe('ExplorerToolbar history', () => {
  it('replaces the history entry, so Back leaves the explorer settings behind', async () => {
    function Back() {
      const navigate = useNavigate();
      return (
        <button
          type="button"
          onClick={() => {
            void navigate(-1);
          }}
        >
          Back
        </button>
      );
    }
    render(
      <MemoryRouter initialEntries={['/start', '/graph/x']} initialIndex={1}>
        <ExplorerToolbar params={DEFAULTS} />
        <LocationProbe />
        <Back />
      </MemoryRouter>,
    );
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Steps' }), '4');
    expect(locationText()).toBe('/graph/x?depth=4');
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(locationText()).toBe('/start');
  });
});

describe('ExplorerToolbar type filters', () => {
  async function open(title: RegExp) {
    await userEvent.click(screen.getByText(title));
  }

  it('lists the 13 entity types in schema order with the selected count in the summary', async () => {
    renderToolbar('/graph/x?entityTypes=Order,Shipment', { ...DEFAULTS, entityTypes: ['Order', 'Shipment'] });
    expect(screen.getByText('Entity types (2)')).toBeInTheDocument();
    await open(/^Entity types/);
    const details = screen.getByText('Entity types (2)').closest('details') as HTMLElement;
    const boxes = Array.from(details.querySelectorAll('input[type="checkbox"]'));
    expect(boxes).toHaveLength(13);
    expect(boxes.map((b) => b.parentElement?.textContent)).toEqual([
      'Customer', 'Contract', 'Order', 'Product', 'Payment', 'Invoice', 'Approval',
      'Warehouse', 'Shipment', 'Supplier', 'SLA', 'BudgetRequirement', 'PurchaseOrder',
    ]);
    expect(screen.getByRole('checkbox', { name: 'Order' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Customer' })).not.toBeChecked();
  });

  it('writes the chosen entity types in schema order and Clear removes the filter', async () => {
    renderToolbar('/graph/x');
    await open(/^Entity types/);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Shipment' }));
    expect(locationText()).toBe('/graph/x?entityTypes=Shipment');
  });

  it('unchecking and Clear update the URL', async () => {
    renderToolbar('/graph/x?entityTypes=Order,Shipment', { ...DEFAULTS, entityTypes: ['Order', 'Shipment'] });
    await open(/^Entity types/);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Order' }));
    expect(locationText()).toBe('/graph/x?entityTypes=Shipment');
    cleanup();

    renderToolbar('/graph/x?entityTypes=Order,Shipment', { ...DEFAULTS, entityTypes: ['Order', 'Shipment'] });
    await open(/^Entity types/);
    const details = screen.getByText('Entity types (2)').closest('details') as HTMLElement;
    await userEvent.click(within(details).getByRole('button', { name: 'Clear entity types' }));
    expect(locationText()).toBe('/graph/x');
  });

  it('offers all 12 relationship types for all directions, including RELATES_TO', async () => {
    renderToolbar('/graph/x');
    await open(/^Relationship types/);
    const details = screen.getByText('Relationship types (0)').closest('details') as HTMLElement;
    expect(details.querySelectorAll('input[type="checkbox"]')).toHaveLength(12);
    expect(within(details).getByRole('checkbox', { name: 'RELATES_TO' })).toBeInTheDocument();
  });

  it('offers only the 11 traceable relationship types for upstream and downstream', async () => {
    renderToolbar('/graph/x?direction=upstream', { ...DEFAULTS, direction: 'upstream' });
    await open(/^Relationship types/);
    const details = screen.getByText('Relationship types (0)').closest('details') as HTMLElement;
    expect(details.querySelectorAll('input[type="checkbox"]')).toHaveLength(11);
    expect(within(details).queryByRole('checkbox', { name: 'RELATES_TO' })).not.toBeInTheDocument();
  });

  it('writes the chosen relationship types in schema order', async () => {
    renderToolbar('/graph/x?relationshipTypes=BLOCKS', { ...DEFAULTS, relationshipTypes: ['BLOCKS'] });
    await open(/^Relationship types/);
    await userEvent.click(screen.getByRole('checkbox', { name: 'REQUIRES' }));
    expect(locationText()).toBe('/graph/x?relationshipTypes=REQUIRES%2CBLOCKS');
  });
});

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
