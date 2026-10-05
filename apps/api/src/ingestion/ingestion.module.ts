import { Module } from '@nestjs/common';
import { ImportService } from './import.service';
import { ImportSnapshotLoader } from './persistence/import-snapshot.loader';
import { ImportWriter } from './persistence/import-writer';

@Module({
  providers: [ImportService, ImportSnapshotLoader, ImportWriter],
  exports: [ImportService],
})
export class IngestionModule {}
