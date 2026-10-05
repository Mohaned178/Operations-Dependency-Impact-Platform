import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from './useAuth';

export function RequireAuth() {
  const { status, user } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return <p>Loading…</p>;
  }

  if (status === 'anonymous' || !user) {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  }

  if (user.mustChangePassword) {
    return <Navigate to="/change-password" replace />;
  }

  return <Outlet />;
}
