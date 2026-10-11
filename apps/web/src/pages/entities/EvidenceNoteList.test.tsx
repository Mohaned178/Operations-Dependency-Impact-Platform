import type { EvidenceNoteDto, PublicUser } from '@opsgraph/shared';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EvidenceNoteList } from './EvidenceNoteList';

const authState = vi.hoisted(() => ({ user: null as PublicUser | null }));
const mutateAsyncMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../../auth/useAuth', () => ({
  useAuth: () => ({ user: authState.user }),
}));

vi.mock('./useEvidenceNotes', () => ({
  useRetractEvidenceNote: () => ({ mutateAsync: mutateAsyncMock, isPending: false }),
}));

const AUTHOR_ID = '20000000-0000-4000-8000-000000000001';
const OTHER_ID = '20000000-0000-4000-8000-000000000002';
const ADMIN_ID = '20000000-0000-4000-8000-000000000003';
const ENTITY_ID = '30000000-0000-4000-8000-000000000001';

const NOTE_ACTIVE: EvidenceNoteDto = {
  id: '10000000-0000-4000-8000-000000000001',
  target: { kind: 'ENTITY', entityId: ENTITY_ID },
  stance: 'SUPPORTS',
  text: 'Carrier confirmed the pickup window.',
  reference: 'Email from carrier, 2026-10-05',
  author: { id: AUTHOR_ID, displayName: 'Alice Analyst' },
  createdAt: '2026-10-06T09:00:00.000Z',
  active: true,
  retraction: null,
};

const NOTE_DISPUTES: EvidenceNoteDto = {
  id: '10000000-0000-4000-8000-000000000002',
  target: { kind: 'ENTITY', entityId: ENTITY_ID },
  stance: 'DISPUTES',
  text: 'The warehouse count does not match the order.',
  reference: null,
  author: { id: OTHER_ID, displayName: 'Bob Bookkeeper' },
  createdAt: '2026-10-07T09:00:00.000Z',
  active: true,
  retraction: null,
};

const NOTE_RETRACTED: EvidenceNoteDto = {
  id: '10000000-0000-4000-8000-000000000003',
  target: { kind: 'ENTITY', entityId: ENTITY_ID },
  stance: 'CONTEXT',
  text: 'Shipping was delayed by the holiday.',
  reference: null,
  author: { id: AUTHOR_ID, displayName: 'Alice Analyst' },
  createdAt: '2026-10-08T09:00:00.000Z',
  active: false,
  retraction: {
    retractedBy: { id: ADMIN_ID, displayName: 'Carol Admin' },
    reason: 'Duplicate of another note',
    retractedAt: '2026-10-09T09:00:00.000Z',
  },
};

function signedIn(id: string, role: PublicUser['role']): void {
  authState.user = {
    id,
    email: 'user@example.com',
    displayName: 'Signed In',
    role,
    status: 'ACTIVE',
    mustChangePassword: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function noteItem(text: string): HTMLElement {
  const item = screen.getByText(text).closest('li');
  if (item === null) {
    throw new Error(`fixture: no list item for "${text}"`);
  }
  return item;
}

describe('EvidenceNoteList', () => {
  beforeEach(() => {
    mutateAsyncMock.mockClear();
    mutateAsyncMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it('hides Retract for a signed-in analyst who is not the author', () => {
    signedIn(OTHER_ID, 'ANALYST');
    render(<EvidenceNoteList notes={[NOTE_ACTIVE]} />);

    expect(screen.queryByRole('button', { name: 'Retract' })).not.toBeInTheDocument();
  });

  it('shows Retract for the author', () => {
    signedIn(AUTHOR_ID, 'ANALYST');
    render(<EvidenceNoteList notes={[NOTE_ACTIVE]} />);

    expect(screen.getByRole('button', { name: 'Retract' })).toBeInTheDocument();
  });

  it('shows Retract for an admin who is not the author', () => {
    signedIn(ADMIN_ID, 'ADMIN');
    render(<EvidenceNoteList notes={[NOTE_ACTIVE]} />);

    expect(screen.getByRole('button', { name: 'Retract' })).toBeInTheDocument();
  });

  it('hides Retract on a retracted note and shows the retraction line, keeping the text readable', () => {
    signedIn(AUTHOR_ID, 'ADMIN');
    render(<EvidenceNoteList notes={[NOTE_RETRACTED]} />);

    expect(screen.queryByRole('button', { name: 'Retract' })).not.toBeInTheDocument();
    expect(
      screen.getByText(/^Retracted by Carol Admin on .+: Duplicate of another note$/),
    ).toBeInTheDocument();
    expect(screen.getByText('Shipping was delayed by the holiday.')).toBeInTheDocument();
  });

  it('retracts with the typed reason, trimmed, for the right note', async () => {
    const user = userEvent.setup();
    signedIn(AUTHOR_ID, 'ANALYST');
    render(<EvidenceNoteList notes={[NOTE_ACTIVE]} />);

    await user.click(screen.getByRole('button', { name: 'Retract' }));
    await user.type(screen.getByLabelText('Reason'), '  Entered in error  ');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(mutateAsyncMock).toHaveBeenCalledTimes(1);
    expect(mutateAsyncMock).toHaveBeenCalledWith({
      noteId: NOTE_ACTIVE.id,
      reason: 'Entered in error',
    });
  });

  it('shows "A reason is required" and does not call the mutation for an empty reason', async () => {
    const user = userEvent.setup();
    signedIn(AUTHOR_ID, 'ANALYST');
    render(<EvidenceNoteList notes={[NOTE_ACTIVE]} />);

    await user.click(screen.getByRole('button', { name: 'Retract' }));
    await user.type(screen.getByLabelText('Reason'), '   ');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(screen.getByRole('alert')).toHaveTextContent('A reason is required');
    expect(mutateAsyncMock).not.toHaveBeenCalled();
  });

  it('shows the form only for the note that was opened', async () => {
    const user = userEvent.setup();
    signedIn(AUTHOR_ID, 'ANALYST');
    render(<EvidenceNoteList notes={[NOTE_ACTIVE, NOTE_RETRACTED]} />);

    await user.click(screen.getByRole('button', { name: 'Retract' }));

    expect(within(noteItem(NOTE_ACTIVE.text)).getByLabelText('Reason')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Reason')).toHaveLength(1);
  });

  it('closes the form on Cancel without calling the mutation', async () => {
    const user = userEvent.setup();
    signedIn(AUTHOR_ID, 'ANALYST');
    render(<EvidenceNoteList notes={[NOTE_ACTIVE]} />);

    await user.click(screen.getByRole('button', { name: 'Retract' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByLabelText('Reason')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retract' })).toBeInTheDocument();
    expect(mutateAsyncMock).not.toHaveBeenCalled();
  });

  it('shows the stance as text', () => {
    signedIn(OTHER_ID, 'ANALYST');
    render(<EvidenceNoteList notes={[NOTE_ACTIVE, NOTE_DISPUTES, NOTE_RETRACTED]} />);

    expect(screen.getByText('Supports')).toBeInTheDocument();
    expect(screen.getByText('Disputes')).toBeInTheDocument();
    expect(screen.getByText('Context')).toBeInTheDocument();
  });
});
