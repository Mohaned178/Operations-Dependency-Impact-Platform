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
    const correlationId = this.requestContext.correlationId;
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
      return {
        status,
        code: status === 404 ? 'NOT_FOUND' : 'INTERNAL',
        message: this.extractMessage(exception.getResponse()),
      };
    }

    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    return { status: 500, code: 'INTERNAL', message: 'Internal error' };
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
