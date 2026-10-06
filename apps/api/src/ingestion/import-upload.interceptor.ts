import {
  Injectable,
  PayloadTooLargeException,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IMPORT_MAX_BYTES } from '@opsgraph/shared';
import { catchError, from, mergeMap, throwError, type Observable } from 'rxjs';
import { ImportService } from './import.service';

@Injectable()
export class ImportUploadInterceptor implements NestInterceptor {
  private readonly upload: NestInterceptor = new (FileInterceptor('file', {
    limits: { fileSize: IMPORT_MAX_BYTES, files: 1 },
  }))();

  constructor(private readonly imports: ImportService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return from(Promise.resolve(this.upload.intercept(context, next))).pipe(
      mergeMap((inner) => inner),
      catchError((error: unknown) => {
        if (error instanceof PayloadTooLargeException) {
          return from(this.imports.refuse('bytes', IMPORT_MAX_BYTES));
        }
        return throwError(() => error);
      }),
    );
  }
}
