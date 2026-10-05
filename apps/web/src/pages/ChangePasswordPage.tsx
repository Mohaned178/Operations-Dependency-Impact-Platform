import { zodResolver } from '@hookform/resolvers/zod';
import { ChangePasswordRequestSchema } from '@opsgraph/shared';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import { useAuth } from '../auth/useAuth';
import { ApiError } from '../lib/api-client';

const ChangePasswordFormSchema = ChangePasswordRequestSchema.innerType()
  .extend({ confirmPassword: z.string().min(1) })
  .refine((data) => data.newPassword === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });

type ChangePasswordForm = z.infer<typeof ChangePasswordFormSchema>;

export function ChangePasswordPage() {
  const { changePassword } = useAuth();
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordForm>({ resolver: zodResolver(ChangePasswordFormSchema) });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await changePassword(values.currentPassword, values.newPassword);
      await navigate('/', { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INVALID_CREDENTIALS') {
        setError('currentPassword', { message: 'Current password is incorrect' });
      } else {
        setError('root', { message: 'Something went wrong. Please try again.' });
      }
    }
  });

  return (
    <div className="mx-auto mt-24 w-full max-w-sm">
      <h1 className="mb-6 text-2xl font-semibold">Change your password</h1>
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          void onSubmit(event);
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="currentPassword">Current password</label>
          <input
            id="currentPassword"
            type="password"
            autoComplete="current-password"
            className="rounded border border-gray-300 px-3 py-2"
            {...register('currentPassword')}
          />
          {errors.currentPassword ? <p role="alert">{errors.currentPassword.message}</p> : null}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="newPassword">New password</label>
          <input
            id="newPassword"
            type="password"
            autoComplete="new-password"
            className="rounded border border-gray-300 px-3 py-2"
            {...register('newPassword')}
          />
          {errors.newPassword ? <p role="alert">{errors.newPassword.message}</p> : null}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="confirmPassword">Confirm new password</label>
          <input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            className="rounded border border-gray-300 px-3 py-2"
            {...register('confirmPassword')}
          />
          {errors.confirmPassword ? <p role="alert">{errors.confirmPassword.message}</p> : null}
        </div>
        {errors.root ? <p role="alert">{errors.root.message}</p> : null}
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded bg-slate-800 px-3 py-2 text-white disabled:opacity-50"
        >
          Change password
        </button>
      </form>
    </div>
  );
}
