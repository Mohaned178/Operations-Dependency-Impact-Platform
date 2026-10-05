import { randomUUID } from 'node:crypto';
import { Global, Injectable, Module } from '@nestjs/common';
import { ClsModule, ClsService } from 'nestjs-cls';
import { z } from 'zod';
import type { Request, Response } from 'express';

const CORRELATION_ID_KEY = 'correlationId';
const IP_KEY = 'ip';
const USER_ID_KEY = 'userId';

const UUID_SCHEMA = z.string().uuid();

@Injectable()
export class RequestContext {
  constructor(private readonly cls: ClsService) {}

  get correlationId(): string {
    return this.cls.get<string>(CORRELATION_ID_KEY) ?? '';
  }

  get ip(): string | undefined {
    return this.cls.get<string | undefined>(IP_KEY);
  }

  get userId(): string | undefined {
    return this.cls.get<string | undefined>(USER_ID_KEY);
  }

  setUserId(id: string): void {
    this.cls.set(USER_ID_KEY, id);
  }
}

@Global()
@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        setup: (cls: ClsService, req: Request, res: Response): void => {
          const header = req.headers['x-request-id'];
          const incoming = Array.isArray(header) ? header[0] : header;
          const correlationId =
            incoming !== undefined && UUID_SCHEMA.safeParse(incoming).success
              ? incoming
              : randomUUID();

          cls.set(CORRELATION_ID_KEY, correlationId);
          cls.set(IP_KEY, req.ip);
          res.setHeader('x-request-id', correlationId);
        },
      },
    }),
  ],
  providers: [RequestContext],
  exports: [RequestContext],
})
export class RequestContextModule {}
