import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CreateUserRequestSchema,
  PublicUserSchema,
  ROLE_LABELS,
  type CreateUserRequest,
} from '@opsgraph/shared';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { ApiError, apiFetch } from '../../lib/api-client';

export function UserCreatePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateUserRequest>({
    resolver: zodResolver(CreateUserRequestSchema),
    defaultValues: { role: 'ANALYST' },
  });

  const createUser = useMutation({
    mutationFn: (values: CreateUserRequest) =>
      apiFetch('/users', { method: 'POST', body: values, schema: PublicUserSchema }),
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      const user = await createUser.mutateAsync(values);
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      await navigate(`/admin/users/${user.id}`);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'EMAIL_TAKEN') {
        setError('email', { message: 'Email is already in use' });
      } else {
        setError('root', { message: 'Something went wrong. Please try again.' });
      }
    }
  });

  return (
    <section className="mx-auto w-full max-w-md">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">New user</h1>
        <Link to="/admin/users" className="text-slate-600 underline">
          Back to users
        </Link>
      </div>
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
            autoComplete="off"
            className="rounded border border-gray-300 px-3 py-2"
            {...register('email')}
          />
          {errors.email ? <p role="alert">{errors.email.message}</p> : null}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="displayName">Display name</label>
          <input
            id="displayName"
            type="text"
            className="rounded border border-gray-300 px-3 py-2"
            {...register('displayName')}
          />
          {errors.displayName ? <p role="alert">{errors.displayName.message}</p> : null}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="role">Role</label>
          <select
            id="role"
            className="rounded border border-gray-300 px-3 py-2"
            {...register('role')}
          >
            {Object.entries(ROLE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {errors.role ? <p role="alert">{errors.role.message}</p> : null}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="temporaryPassword">Temporary password</label>
          <input
            id="temporaryPassword"
            type="password"
            autoComplete="new-password"
            className="rounded border border-gray-300 px-3 py-2"
            {...register('temporaryPassword')}
          />
          {errors.temporaryPassword ? (
            <p role="alert">{errors.temporaryPassword.message}</p>
          ) : null}
        </div>
        {errors.root ? <p role="alert">{errors.root.message}</p> : null}
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded bg-slate-800 px-3 py-2 text-white disabled:opacity-50"
        >
          Create user
        </button>
      </form>
    </section>
  );
}
