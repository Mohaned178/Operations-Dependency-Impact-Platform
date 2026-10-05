import type { ErrorCode } from '@opsgraph/shared';

export interface ErrorDetail {
  path: string;
  message: string;
}

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
    readonly details?: ErrorDetail[],
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  validation(details: ErrorDetail[]): AppError {
    return new AppError('VALIDATION_FAILED', 400, 'Validation failed', details);
  },

  invalidCredentials(): AppError {
    return new AppError('INVALID_CREDENTIALS', 401, 'Invalid email or password');
  },

  unauthenticated(): AppError {
    return new AppError('UNAUTHENTICATED', 401, 'Authentication required');
  },

  passwordChangeRequired(): AppError {
    return new AppError('PASSWORD_CHANGE_REQUIRED', 403, 'Password change required');
  },

  forbidden(): AppError {
    return new AppError('FORBIDDEN', 403, 'You are not permitted to perform this action');
  },

  notFound(what: string): AppError {
    return new AppError('NOT_FOUND', 404, `${what} not found`);
  },

  emailTaken(): AppError {
    return new AppError('EMAIL_TAKEN', 409, 'Email is already in use');
  },

  lastAdmin(): AppError {
    return new AppError('LAST_ADMIN', 409, 'At least one active Administrator is required');
  },
};
