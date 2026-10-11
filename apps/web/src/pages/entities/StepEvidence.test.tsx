import { cleanup, render, screen } from '@testing-library/react';
import {
  RootCauseResponseSchema,
  type EntityEvidenceDto,
  type NoteEvidenceDto,
} from '@opsgraph/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { StepEvidence } from './StepEvidence';
import { R1_ORDER, R2_SHIPMENT, R4_NOT_BLOCKED, R5_UNEXPLAINED } from './root-cause-test-data';
import { BR_ID } from './tracing-test-data';

describe('StepEvidence', () => {
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

    render(<StepEvidence evidence={evidence} />);

    expect(screen.getByText('Budget code was supplied on 2026-09-30')).toBeInTheDocument();
    expect(screen.getByText('Stance: DISPUTES · Author: Analyst B')).toBeInTheDocument();
    expect(screen.getByText('retracted')).toBeInTheDocument();
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

    render(<StepEvidence evidence={evidence} />);

    expect(screen.getByText('Manual')).toBeInTheDocument();
    expect(
      screen.getByText('Finance confirmed the budget code was never submitted'),
    ).toBeInTheDocument();
    expect(screen.queryByText('retracted')).not.toBeInTheDocument();
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
});
