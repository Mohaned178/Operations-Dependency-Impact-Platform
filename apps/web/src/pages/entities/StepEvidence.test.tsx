import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import {
  RootCauseResponseSchema,
  type EntityEvidenceDto,
  type NoteEvidenceDto,
} from '@opsgraph/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StepEvidence } from './StepEvidence';
import { R1_ORDER, R2_SHIPMENT, R4_NOT_BLOCKED, R5_UNEXPLAINED } from './root-cause-test-data';
import { BR_ID } from './tracing-test-data';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));

vi.mock('../../lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api-client')>();
  return { ...actual, apiFetch: apiFetchMock };
});

vi.mock('../../auth/useAuth', () => ({
  useAuth: () => ({
    user: { id: '70000000-0000-4000-8000-000000000002', role: 'ANALYST' },
  }),
}));

/** Notes and the note form use TanStack Query hooks, so those renders need a client. */
function renderWithQuery(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('StepEvidence', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('parses every root-cause fixture with RootCauseResponseSchema', () => {
    for (const fixture of [R1_ORDER, R2_SHIPMENT, R4_NOT_BLOCKED, R5_UNEXPLAINED]) {
      expect(() => RootCauseResponseSchema.parse(fixture)).not.toThrow();
    }
  });

  it('shows the requirement clause and the event count for BR-18492', () => {
    const evidence = R1_ORDER.evidence.entities.find((entity) => entity.entityId === BR_ID);
    if (evidence === undefined) {
      throw new Error('expected BR-18492 evidence');
    }

    render(<StepEvidence evidence={evidence} />);

    expect(screen.getByRole('heading', { name: 'Events (1 of 1)' })).toBeInTheDocument();
    expect(screen.getByText(/EVT-FA-3002/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Requirement sources' })).toBeInTheDocument();
    expect(screen.getByText('Contract CON-3982 DEFINES this entity')).toBeInTheDocument();
    expect(
      screen.getByText(
        'clause: Orders above 10,000.00 USD require finance approval with a budget code',
      ),
    ).toBeInTheDocument();
  });

  it('says None under every heading when the evidence is empty', () => {
    const empty: EntityEvidenceDto = {
      entityId: BR_ID,
      stateRecords: [],
      requirementSources: { items: [], total: 0 },
      events: { items: [], total: 0 },
      notes: { items: [], total: 0 },
    };

    render(<StepEvidence evidence={empty} />);

    expect(screen.getByRole('heading', { name: 'Events (0 of 0)' })).toBeInTheDocument();
    expect(screen.getAllByText('None')).toHaveLength(5);
  });

  it('marks a retracted note as retracted in text', () => {
    const retracted: NoteEvidenceDto = {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      rule: 'MANUAL_NOTE',
      origin: 'MANUAL',
      target: { kind: 'ENTITY', entityId: BR_ID },
      stance: 'DISPUTES',
      text: 'Budget code was supplied on 2026-09-30',
      reference: null,
      author: { id: '70000000-0000-4000-8000-000000000001', displayName: 'Analyst B' },
      createdAt: '2026-09-30T09:00:00.000Z',
      active: false,
      retraction: {
        retractedBy: { id: '70000000-0000-4000-8000-000000000001', displayName: 'Analyst B' },
        reason: 'Confirmed with Finance',
        retractedAt: '2026-09-30T10:00:00.000Z',
      },
    };
    const evidence: EntityEvidenceDto = {
      entityId: BR_ID,
      stateRecords: [],
      requirementSources: { items: [], total: 0 },
      events: { items: [], total: 0 },
      notes: { items: [retracted], total: 1 },
    };

    renderWithQuery(<StepEvidence evidence={evidence} />);

    expect(screen.getByText('Budget code was supplied on 2026-09-30')).toBeInTheDocument();
    expect(screen.getByText('Disputes')).toBeInTheDocument();
    expect(screen.getByText('Retracted')).toBeInTheDocument();
    expect(
      screen.getByText(/^Retracted by Analyst B on .+: Confirmed with Finance$/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retract' })).not.toBeInTheDocument();
  });

  it('names the entity in requirement-source lines when entityName is given', () => {
    const evidence = R1_ORDER.evidence.entities.find((entity) => entity.entityId === BR_ID);
    if (evidence === undefined) {
      throw new Error('expected BR-18492 evidence');
    }

    render(<StepEvidence evidence={evidence} entityName="Budget code for Order #18492" />);

    expect(
      screen.getByText('Contract CON-3982 DEFINES Budget code for Order #18492'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/this entity/)).not.toBeInTheDocument();
  });

  it('labels every note as Manual', () => {
    const note: NoteEvidenceDto = {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      rule: 'MANUAL_NOTE',
      origin: 'MANUAL',
      target: { kind: 'ENTITY', entityId: BR_ID },
      stance: 'SUPPORTS',
      text: 'Finance confirmed the budget code was never submitted',
      reference: null,
      author: { id: '70000000-0000-4000-8000-000000000002', displayName: 'Analyst A' },
      createdAt: '2026-09-30T08:00:00.000Z',
      active: true,
      retraction: null,
    };
    const evidence: EntityEvidenceDto = {
      entityId: BR_ID,
      stateRecords: [],
      requirementSources: { items: [], total: 0 },
      events: { items: [], total: 0 },
      notes: { items: [note], total: 1 },
    };

    renderWithQuery(<StepEvidence evidence={evidence} />);

    expect(screen.getByText('Manual')).toBeInTheDocument();
    expect(
      screen.getByText('Finance confirmed the budget code was never submitted'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Retracted')).not.toBeInTheDocument();
  });

  it('labels the latest record of another source "Other source", not an earlier observation', () => {
    const order = R1_ORDER.evidence.entities.find(
      (entity) => entity.entityId === R1_ORDER.query.entityId,
    );
    if (order === undefined) {
      throw new Error('expected Order #18492 evidence');
    }
    render(<StepEvidence evidence={order} />);

    expect(screen.getByText('Current state')).toBeInTheDocument();
    expect(screen.getByText('Other source')).toBeInTheDocument();
    expect(screen.queryByText('Earlier observation')).toBeNull();
  });

  it('names a relationship by the hop as recorded instead of its id', () => {
    const budget = R1_ORDER.evidence.entities.find((entity) => entity.entityId === BR_ID);
    const relationship = R1_ORDER.evidence.relationships.at(-1);
    if (budget === undefined || relationship === undefined) {
      throw new Error('expected BR-18492 evidence and a relationship');
    }
    render(
      <StepEvidence
        evidence={budget}
        relationships={[relationship]}
        relationshipLabel="Finance approval APR-2291 REQUIRES Budget code for Order #18492"
      />,
    );

    expect(
      screen.getByText('Finance approval APR-2291 REQUIRES Budget code for Order #18492'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Relationship [0-9a-f-]{36}$/)).toBeNull();
  });

  it('shows how many requirement sources were returned when the list is capped', () => {
    const budget = R1_ORDER.evidence.entities.find((entity) => entity.entityId === BR_ID);
    if (budget === undefined) {
      throw new Error('expected BR-18492 evidence');
    }
    const capped: EntityEvidenceDto = {
      ...budget,
      requirementSources: { ...budget.requirementSources, total: 25 },
    };
    render(<StepEvidence evidence={capped} />);

    expect(
      screen.getByRole('heading', { name: 'Requirement sources (1 of 25)' }),
    ).toBeInTheDocument();
  });

  describe('adding a note', () => {
    function budgetEvidence(): EntityEvidenceDto {
      const budget = R1_ORDER.evidence.entities.find((entity) => entity.entityId === BR_ID);
      if (budget === undefined) {
        throw new Error('expected BR-18492 evidence');
      }
      return budget;
    }

    it('offers two targets on a step reached by a hop: the entity and the link', async () => {
      const user = userEvent.setup();
      const relationship = R1_ORDER.evidence.relationships.at(-1);
      if (relationship === undefined) {
        throw new Error('expected a relationship');
      }
      const label = 'Finance approval APR-2291 REQUIRES Budget code for Order #18492';
      renderWithQuery(
        <StepEvidence
          evidence={budgetEvidence()}
          relationships={[relationship]}
          relationshipLabel={label}
          linkRelationshipId={relationship.relationshipId}
        />,
      );

      expect(screen.queryByRole('heading', { name: 'Add note' })).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Add note' }));

      const attachTo = screen.getByRole('group', { name: 'Attach to' });
      expect(within(attachTo).getAllByRole('radio')).toHaveLength(2);
      expect(within(attachTo).getByLabelText('this entity')).toBeChecked();
      expect(within(attachTo).getByLabelText(`the link: ${label}`)).toBeInTheDocument();
    });

    it('offers only "this entity" on the symptom step, which has no hop', async () => {
      const user = userEvent.setup();
      renderWithQuery(<StepEvidence evidence={budgetEvidence()} />);

      await user.click(screen.getByRole('button', { name: 'Add note' }));

      expect(screen.getByRole('heading', { name: 'Add note' })).toBeInTheDocument();
      expect(screen.queryByRole('group', { name: 'Attach to' })).not.toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'Stance' })).toBeInTheDocument();
    });

    it('closes the form again on Cancel', async () => {
      const user = userEvent.setup();
      renderWithQuery(<StepEvidence evidence={budgetEvidence()} />);

      await user.click(screen.getByRole('button', { name: 'Add note' }));
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(screen.queryByRole('group', { name: 'Stance' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add note' })).toBeInTheDocument();
    });
  });

  describe('Show all notes', () => {
    const note = (n: number): NoteEvidenceDto => ({
      id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`,
      rule: 'MANUAL_NOTE',
      origin: 'MANUAL',
      target: { kind: 'ENTITY', entityId: BR_ID },
      stance: 'CONTEXT',
      text: `Note number ${n}`,
      reference: null,
      author: { id: '70000000-0000-4000-8000-000000000002', displayName: 'Analyst A' },
      createdAt: '2026-09-30T08:00:00.000Z',
      active: true,
      retraction: null,
    });

    it('shows the button only when the total exceeds the notes returned, and pages the rest in', async () => {
      const user = userEvent.setup();
      const evidence: EntityEvidenceDto = {
        entityId: BR_ID,
        stateRecords: [],
        requirementSources: { items: [], total: 0 },
        events: { items: [], total: 0 },
        notes: { items: [note(2), note(1)], total: 3 },
      };
      apiFetchMock.mockResolvedValue({ items: [note(3), note(2), note(1)], nextCursor: null });
      renderWithQuery(<StepEvidence evidence={evidence} />);

      expect(screen.getByText('Note number 2')).toBeInTheDocument();
      expect(screen.queryByText('Note number 3')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Show all 3' }));

      expect(await screen.findByText('Note number 3')).toBeInTheDocument();
      expect(apiFetchMock.mock.calls[0]?.[0]).toMatch(
        new RegExp(`^/entities/${BR_ID}/evidence-notes\\?limit=50$`),
      );
      expect(screen.queryByRole('button', { name: /Show all/ })).not.toBeInTheDocument();
    });

    it('has no Show all button when every note is already shown', () => {
      const evidence: EntityEvidenceDto = {
        entityId: BR_ID,
        stateRecords: [],
        requirementSources: { items: [], total: 0 },
        events: { items: [], total: 0 },
        notes: { items: [note(1)], total: 1 },
      };
      renderWithQuery(<StepEvidence evidence={evidence} />);

      expect(screen.queryByRole('button', { name: /Show all/ })).not.toBeInTheDocument();
    });
  });
});
