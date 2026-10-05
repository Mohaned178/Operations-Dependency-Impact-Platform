import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChangePasswordPage } from './ChangePasswordPage';

const { changePassword } = vi.hoisted(() => ({ changePassword: vi.fn() }));

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({ changePassword }),
}));

describe('ChangePasswordPage', () => {
  afterEach(() => {
    cleanup();
    changePassword.mockReset();
  });

  it('requires the new password to differ from the current one', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ChangePasswordPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('Current password'), 'OpsGraph-Test-2026!');
    await user.type(screen.getByLabelText('New password'), 'OpsGraph-Test-2026!');
    await user.type(screen.getByLabelText('Confirm new password'), 'OpsGraph-Test-2026!');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(
      await screen.findByText('New password must differ from the current password'),
    ).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
  });
});
