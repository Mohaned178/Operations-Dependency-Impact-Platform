import { CreateEvidenceNoteRequestSchema } from '@opsgraph/shared';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api-client';
import { EvidenceNoteForm, type EvidenceNoteFormTarget } from './EvidenceNoteForm';

const { mutateAsyncMock } = vi.hoisted(() => ({ mutateAsyncMock: vi.fn() }));

vi.mock('./useEvidenceNotes', () => ({
  useCreateEvidenceNote: () => ({ mutateAsync: mutateAsyncMock, isPending: false }),
}));

const ENTITY_ID = '6f1c2a3e-1111-4b2c-8d3e-111122223333';
const RELATIONSHIP_ID = '7a2d3b4f-2222-4c3d-9e4f-222233334444';

const ENTITY_TARGET: EvidenceNoteFormTarget = {
  label: 'this entity',
  target: { kind: 'ENTITY', entityId: ENTITY_ID },
};
const RELATIONSHIP_TARGET: EvidenceNoteFormTarget = {
  label: 'the link',
  target: { kind: 'RELATIONSHIP', relationshipId: RELATIONSHIP_ID },
};

describe('EvidenceNoteForm', () => {
  beforeEach(() => {
    mutateAsyncMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows both validation errors and sends nothing when submitted empty', async () => {
    const user = userEvent.setup();
    render(<EvidenceNoteForm targets={[ENTITY_TARGET]} />);

    await user.click(screen.getByRole('button', { name: 'Save note' }));

    expect(screen.getByText('Choose a stance')).toBeInTheDocument();
    expect(screen.getByText('Enter the note text')).toBeInTheDocument();
    expect(screen.getAllByRole('alert')).toHaveLength(2);
    expect(mutateAsyncMock).not.toHaveBeenCalled();
  });

  it('sends a schema-valid trimmed payload for the chosen target, then calls onDone', async () => {
    const user = userEvent.setup();
    mutateAsyncMock.mockResolvedValue({});
    const onDone = vi.fn();
    render(<EvidenceNoteForm targets={[ENTITY_TARGET, RELATIONSHIP_TARGET]} onDone={onDone} />);

    await user.click(screen.getByRole('radio', { name: 'the link' }));
    await user.click(screen.getByRole('radio', { name: 'Disputes' }));
    await user.type(screen.getByLabelText('Note'), '  Carrier confirmed a delay  ');
    await user.type(screen.getByLabelText('Reference (optional)'), 'TRK-99');
    await user.click(screen.getByRole('button', { name: 'Save note' }));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(mutateAsyncMock).toHaveBeenCalledTimes(1);
    const sent: unknown = mutateAsyncMock.mock.calls[0]?.[0];
    const parsed = CreateEvidenceNoteRequestSchema.safeParse(sent);
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }
    expect(parsed.data.text).toBe('Carrier confirmed a delay');
    expect(parsed.data.reference).toBe('TRK-99');
    expect(parsed.data.target).toEqual(RELATIONSHIP_TARGET.target);
    expect(parsed.data.stance).toBe('DISPUTES');
  });

  it('renders the "Attach to" group only when there is more than one target', () => {
    const { unmount } = render(<EvidenceNoteForm targets={[ENTITY_TARGET]} />);
    expect(screen.queryByRole('group', { name: 'Attach to' })).not.toBeInTheDocument();
    unmount();

    render(<EvidenceNoteForm targets={[ENTITY_TARGET, RELATIONSHIP_TARGET]} />);
    const group = screen.getByRole('group', { name: 'Attach to' });
    expect(within(group).getByRole('radio', { name: 'this entity' })).toBeChecked();
    expect(within(group).getByRole('radio', { name: 'the link' })).not.toBeChecked();
  });

  it('shows each server error detail in an alert and does not call onDone', async () => {
    const user = userEvent.setup();
    mutateAsyncMock.mockRejectedValue(
      new ApiError(400, 'VALIDATION_FAILED', 'Validation failed', [
        { path: 'target.entityId', message: 'Entity not found' },
      ]),
    );
    const onDone = vi.fn();
    render(<EvidenceNoteForm targets={[ENTITY_TARGET]} onDone={onDone} />);

    await user.click(screen.getByRole('radio', { name: 'Context' }));
    await user.type(screen.getByLabelText('Note'), 'Some context');
    await user.click(screen.getByRole('button', { name: 'Save note' }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('target.entityId: Entity not found')).toBeInTheDocument();
    expect(mutateAsyncMock).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('shows the character counter at 0 / 2000 and updates as the user types', async () => {
    const user = userEvent.setup();
    render(<EvidenceNoteForm targets={[ENTITY_TARGET]} />);

    expect(screen.getByText('0 / 2000')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Note'), 'abc');

    expect(screen.getByText('3 / 2000')).toBeInTheDocument();
  });
});
