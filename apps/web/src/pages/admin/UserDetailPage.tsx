import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PublicUserSchema,
  ResetPasswordRequestSchema,
  ROLE_LABELS,
  UpdateUserRequestSchema,
  type ResetPasswordRequest,
  type UpdateUserRequest,
} from '@opsgraph/shared';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useParams } from 'react-router';
import { ApiError, apiFetch } from '../../lib/api-client';

function lastAdminMessage(error: unknown): string | null {
  if (error instanceof ApiError && error.code === 'LAST_ADMIN') {
    return error.message;
  }
  return null;
}

export function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const userId = id ?? '';
  const queryClient = useQueryClient();
  const [banner, setBanner] = useState<string | null>(null);
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  const userQuery = useQuery({
    queryKey: ['users', userId],
    queryFn: () => apiFetch(`/users/${userId}`, { schema: PublicUserSchema }),
    enabled: userId.length > 0,
  });

  const {
    register: registerEdit,
    handleSubmit: handleEditSubmit,
    reset: resetEditForm,
    formState: { errors: editErrors, isSubmitting: isSaving },
  } = useForm<UpdateUserRequest>({ resolver: zodResolver(UpdateUserRequestSchema) });

  const {
    register: registerReset,
    handleSubmit: handleResetSubmit,
    reset: resetResetForm,
    formState: { errors: resetErrors },
  } = useForm<ResetPasswordRequest>({ resolver: zodResolver(ResetPasswordRequestSchema) });

  const user = userQuery.data;

  useEffect(() => {
    if (user) {
      resetEditForm({ displayName: user.displayName, role: user.role });
    }
  }, [user, resetEditForm]);

  const invalidateUsers = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['users'] });
  };

  const updateUser = useMutation({
    mutationFn: (values: UpdateUserRequest) =>
      apiFetch(`/users/${userId}`, { method: 'PATCH', body: values, schema: PublicUserSchema }),
  });

  const setStatus = useMutation({
    mutationFn: (command: 'deactivate' | 'reactivate') =>
      apiFetch(`/users/${userId}/${command}`, { method: 'POST', schema: PublicUserSchema }),
  });

  const resetPassword = useMutation({
    mutationFn: (values: ResetPasswordRequest) =>
      apiFetch<void>(`/users/${userId}/reset-password`, { method: 'POST', body: values }),
  });

  const onSave = handleEditSubmit(async (values) => {
    setBanner(null);
    try {
      await updateUser.mutateAsync(values);
      await invalidateUsers();
    } catch (error) {
      setBanner(lastAdminMessage(error) ?? 'Something went wrong. Please try again.');
    }
  });

  const onResetPassword = handleResetSubmit(async (values) => {
    setBanner(null);
    setResetMessage(null);
    try {
      await resetPassword.mutateAsync(values);
      setResetMessage('Temporary password set. The user must change it at next sign-in.');
      resetResetForm();
    } catch (error) {
      setBanner(lastAdminMessage(error) ?? 'Something went wrong. Please try again.');
    }
  });

  const onToggleStatus = async (): Promise<void> => {
    if (!user) {
      return;
    }
    const command = user.status === 'ACTIVE' ? 'deactivate' : 'reactivate';
    if (command === 'deactivate' && !window.confirm(`Deactivate ${user.displayName}?`)) {
      return;
    }
    setBanner(null);
    try {
      await setStatus.mutateAsync(command);
      await invalidateUsers();
    } catch (error) {
      setBanner(lastAdminMessage(error) ?? 'Something went wrong. Please try again.');
    }
  };

  if (!id) {
    return <p role="alert">Unable to load user.</p>;
  }

  if (userQuery.isPending) {
    return <p>Loading…</p>;
  }

  if (userQuery.isError || !user) {
    return <p role="alert">Unable to load user.</p>;
  }

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{user.displayName}</h1>
          <p className="text-slate-600">{user.email}</p>
          <p className="text-sm text-slate-500">
            {ROLE_LABELS[user.role]} · {user.status}
          </p>
        </div>
        <Link to="/admin/users" className="text-slate-600 underline">
          Back to users
        </Link>
      </div>

      {banner ? (
        <p role="alert" className="rounded border border-red-300 bg-red-50 px-3 py-2 text-red-800">
          {banner}
        </p>
      ) : null}

      <form
        className="flex max-w-md flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          void onSave(event);
        }}
      >
        <h2 className="text-lg font-medium">Profile</h2>
        <div className="flex flex-col gap-1">
          <label htmlFor="displayName">Display name</label>
          <input
            id="displayName"
            type="text"
            className="rounded border border-gray-300 px-3 py-2"
            {...registerEdit('displayName')}
          />
          {editErrors.displayName ? <p role="alert">{editErrors.displayName.message}</p> : null}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="role">Role</label>
          <select
            id="role"
            className="rounded border border-gray-300 px-3 py-2"
            {...registerEdit('role')}
          >
            {Object.entries(ROLE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {editErrors.root ? <p role="alert">{editErrors.root.message}</p> : null}
        <button
          type="submit"
          disabled={isSaving}
          className="self-start rounded bg-slate-800 px-3 py-2 text-white disabled:opacity-50"
        >
          Save changes
        </button>
      </form>

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Status</h2>
        <button
          type="button"
          onClick={() => {
            void onToggleStatus();
          }}
          className="self-start rounded border border-slate-300 px-3 py-2"
        >
          {user.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
        </button>
      </div>

      <form
        className="flex max-w-md flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          void onResetPassword(event);
        }}
      >
        <h2 className="text-lg font-medium">Reset password</h2>
        <div className="flex flex-col gap-1">
          <label htmlFor="temporaryPassword">Temporary password</label>
          <input
            id="temporaryPassword"
            type="password"
            autoComplete="new-password"
            className="rounded border border-gray-300 px-3 py-2"
            {...registerReset('temporaryPassword')}
          />
          {resetErrors.temporaryPassword ? (
            <p role="alert">{resetErrors.temporaryPassword.message}</p>
          ) : null}
        </div>
        <button
          type="submit"
          className="self-start rounded border border-slate-300 px-3 py-2"
        >
          Set temporary password
        </button>
        {resetMessage ? <p role="status">{resetMessage}</p> : null}
      </form>
    </section>
  );
}
