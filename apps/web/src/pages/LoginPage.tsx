import { zodResolver } from '@hookform/resolvers/zod';
import { LoginRequestSchema, type LoginRequest } from '@opsgraph/shared';
import { useForm } from 'react-hook-form';
import { useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../auth/useAuth';
import { ApiError } from '../lib/api-client';

function isSafeNext(next: string | null): next is string {
  return next !== null && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\');
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginRequest>({ resolver: zodResolver(LoginRequestSchema) });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await login(values.email, values.password);
      const next = searchParams.get('next');
      await navigate(isSafeNext(next) ? next : '/', { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INVALID_CREDENTIALS') {
        setError('root', { message: 'Invalid email or password' });
      } else {
        setError('root', { message: 'Something went wrong. Please try again.' });
      }
    }
  });

  return (
    <div className="mx-auto mt-24 w-full max-w-sm">
      <h1 className="mb-6 text-2xl font-semibold">Sign in to OpsGraph</h1>
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          void onSubmit(event);
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            className="rounded border border-gray-300 px-3 py-2"
            {...register('email')}
          />
          {errors.email ? <p role="alert">{errors.email.message}</p> : null}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            className="rounded border border-gray-300 px-3 py-2"
            {...register('password')}
          />
          {errors.password ? <p role="alert">{errors.password.message}</p> : null}
        </div>
        {errors.root ? <p role="alert">{errors.root.message}</p> : null}
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded bg-slate-800 px-3 py-2 text-white disabled:opacity-50"
        >
          Sign in
        </button>
      </form>
    </div>
  );
}
