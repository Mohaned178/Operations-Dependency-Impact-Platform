import { Module } from '@nestjs/common';
import { ImportUploadInterceptor } from './import-upload.interceptor';
import { ImportService } from './import.service';
import { ImportsController } from './imports.controller';
import { ImportSnapshotLoader } from './persistence/import-snapshot.loader';
import { ImportWriter } from './persistence/import-writer';
import { SeedService } from './seed/seed.service';

@Module({
  controllers: [ImportsController],
  providers: [ImportService, ImportSnapshotLoader, ImportWriter, SeedService, ImportUploadInterceptor],
  exports: [ImportService, SeedService],
})
export class IngestionModule {}
