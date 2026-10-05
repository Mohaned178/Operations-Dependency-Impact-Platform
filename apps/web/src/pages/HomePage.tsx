import { useAuth } from '../auth/useAuth';

export function HomePage() {
  const { user } = useAuth();

  return <h1 className="text-2xl font-semibold">Welcome, {user?.displayName ?? 'there'}</h1>;
}
