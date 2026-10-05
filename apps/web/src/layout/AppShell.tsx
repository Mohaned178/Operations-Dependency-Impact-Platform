import { ROLE_LABELS } from '@opsgraph/shared';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../auth/useAuth';

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return isActive ? 'font-semibold text-slate-900' : 'text-slate-600';
}

export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  if (!user) {
    return null;
  }

  const handleSignOut = async (): Promise<void> => {
    await logout();
    await navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b bg-white px-6 py-3">
        <span className="text-lg font-semibold">OpsGraph</span>
        <div className="flex items-center gap-4">
          <span>{user.displayName}</span>
          <span>{ROLE_LABELS[user.role]}</span>
          <button
            type="button"
            onClick={() => {
              void handleSignOut();
            }}
            className="rounded border border-slate-300 px-3 py-1"
          >
            Sign out
          </button>
        </div>
      </header>
      <div className="flex">
        <nav className="flex w-56 flex-col gap-2 border-r bg-white p-4">
          <NavLink to="/" className={navLinkClass} end>
            Home
          </NavLink>
          <NavLink to="/investigations" className={navLinkClass}>
            Investigations
          </NavLink>
          <NavLink to="/graph" className={navLinkClass}>
            Graph Explorer
          </NavLink>
          <NavLink to="/exceptions" className={navLinkClass}>
            Exceptions
          </NavLink>
          {user.role === 'ADMIN' ? (
            <>
              <NavLink to="/admin/users" className={navLinkClass}>
                Users
              </NavLink>
              <NavLink to="/admin/audit" className={navLinkClass}>
                Audit
              </NavLink>
            </>
          ) : null}
        </nav>
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
