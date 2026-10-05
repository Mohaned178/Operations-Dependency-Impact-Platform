import { createBrowserRouter } from 'react-router';
import { RequireAuth } from './auth/RequireAuth';
import { RequireRole } from './auth/RequireRole';
import { AppShell } from './layout/AppShell';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { ComingSoonPage } from './pages/ComingSoonPage';
import { EntityDetailPage } from './pages/entities/EntityDetailPage';
import { EntityListPage } from './pages/entities/EntityListPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { AuditPage } from './pages/admin/AuditPage';
import { UserCreatePage } from './pages/admin/UserCreatePage';
import { UserDetailPage } from './pages/admin/UserDetailPage';
import { UsersListPage } from './pages/admin/UsersListPage';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/change-password', element: <ChangePasswordPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <HomePage /> },
          { path: 'entities', element: <EntityListPage /> },
          { path: 'entities/:id', element: <EntityDetailPage /> },
          { path: 'investigations', element: <ComingSoonPage /> },
          { path: 'graph', element: <ComingSoonPage /> },
          { path: 'exceptions', element: <ComingSoonPage /> },
          {
            path: 'admin',
            element: <RequireRole role="ADMIN" />,
            children: [
              { path: 'users', element: <UsersListPage /> },
              { path: 'users/new', element: <UserCreatePage /> },
              { path: 'users/:id', element: <UserDetailPage /> },
              { path: 'audit', element: <AuditPage /> },
            ],
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);
