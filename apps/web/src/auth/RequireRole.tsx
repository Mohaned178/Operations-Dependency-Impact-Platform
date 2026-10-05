import type { Role } from '@opsgraph/shared';
import { Outlet } from 'react-router';
import { ForbiddenPage } from '../pages/ForbiddenPage';
import { useAuth } from './useAuth';

export function RequireRole({ role }: { role: Role }) {
  const { user } = useAuth();

  if (!user || user.role !== role) {
    return <ForbiddenPage />;
  }

  return <Outlet />;
}
