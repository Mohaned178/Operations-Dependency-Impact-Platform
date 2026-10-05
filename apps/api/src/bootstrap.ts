import cookieParser from 'cookie-parser';
import type { NestExpressApplication } from '@nestjs/platform-express';

export function configureApp(app: NestExpressApplication): void {
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.enableShutdownHooks();
  app.set('trust proxy', 'loopback');
}
