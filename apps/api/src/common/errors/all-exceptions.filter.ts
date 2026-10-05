import { randomUUID } from 'node:crypto';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { ErrorCode } from '@opsgraph/shared';
import type { Response } from 'express';
import { RequestContext } from '../context/request-context';
import { AppError, type ErrorDetail } from './app-error';

interface ErrorBody {
  status: number;
  code: ErrorCode;
  message: string;
  details?: ErrorDetail[];
}

@Injectable()
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly requestContext: RequestContext) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    // Body-parser errors are raised before the request-context middleware runs.
    let correlationId = this.requestContext.correlationId;
    if (!correlationId) {
      correlationId = randomUUID();
      response.setHeader('x-request-id', correlationId);
    }
    const body = this.toErrorBody(exception);

    response.status(body.status).json({
      error: {
        code: body.code,
        message: body.message,
        ...(body.details ? { details: body.details } : {}),
        correlationId,
      },
    });
  }

  private toErrorBody(exception: unknown): ErrorBody {
    if (exception instanceof AppError) {
      return {
        status: exception.status,
        code: exception.code,
        message: exception.message,
        ...(exception.details ? { details: exception.details } : {}),
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status >= 500) {
        this.logger.error(exception instanceof Error ? exception.stack : String(exception));
        return { status: 500, code: 'INTERNAL', message: 'Internal error' };
      }
      return {
        status,
        code: this.httpStatusToCode(status),
        message: this.extractMessage(exception.getResponse()),
      };
    }

    const clientStatus = this.exposedClientStatus(exception);
    if (clientStatus !== undefined) {
      return {
        status: clientStatus,
        code: this.httpStatusToCode(clientStatus),
        message: clientStatus === 413 ? 'Request body too large' : 'Bad request',
      };
    }

    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    return { status: 500, code: 'INTERNAL', message: 'Internal error' };
  }

  // http-errors raised by body-parser (e.g. PayloadTooLargeError) are not HttpExceptions.
  private exposedClientStatus(exception: unknown): number | undefined {
    if (typeof exception !== 'object' || exception === null) {
      return undefined;
    }
    const { status, expose } = exception as { status?: unknown; expose?: unknown };
    if (expose === true && typeof status === 'number' && status >= 400 && status < 500) {
      return status;
    }
    return undefined;
  }

  private httpStatusToCode(status: number): ErrorCode {
    switch (status) {
      case 401:
        return 'UNAUTHENTICATED';
      case 403:
        return 'FORBIDDEN';
      case 404:
        return 'NOT_FOUND';
      default:
        return 'VALIDATION_FAILED';
    }
  }

  private extractMessage(payload: string | object): string {
    if (typeof payload === 'string') {
      return payload;
    }
    if ('message' in payload) {
      const message: unknown = payload.message;
      if (typeof message === 'string') {
        return message;
      }
      if (Array.isArray(message)) {
        return message.filter((entry): entry is string => typeof entry === 'string').join('; ');
      }
    }
    return 'Internal error';
  }
}
