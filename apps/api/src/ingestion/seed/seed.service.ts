import { Injectable } from '@nestjs/common';
import type { ImportDocument, ImportReport } from '@opsgraph/shared';
import { RequestContext } from '../../common/context/request-context';
import { ImportService } from '../import.service';
import { buildScenario39Document } from './scenario-39';
import { buildScenario40Document } from './scenario-40';

@Injectable()
export class SeedService {
  constructor(
    private readonly imports: ImportService,
    private readonly requestContext: RequestContext,
  ) {}

  seedScenario39(): Promise<ImportReport | null> {
    return this.seed(buildScenario39Document(), 'scenario-39.json', '§39');
  }

  seedScenario40(): Promise<ImportReport | null> {
    return this.seed(buildScenario40Document(), 'scenario-40.json', '§40');
  }

  private async seed(
    document: ImportDocument,
    fileName: string,
    label: string,
  ): Promise<ImportReport | null> {
    const content = Buffer.from(JSON.stringify(document), 'utf8');

    const report = await this.requestContext.runDetached(() =>
      this.imports.run({
        format: 'json',
        fileName,
        byteSize: content.byteLength,
        content,
        trigger: 'SEED',
        dryRun: false,
        skipIfNoChanges: true,
        actor: { type: 'system' },
      }),
    );

    if (report !== null && report.outcome === 'REJECTED') {
      const details = [
        ...report.fileErrors.map((message) => `file: ${message}`),
        ...report.rowErrors.map(
          (error) =>
            `row ${error.row} (${error.kind})${error.field === null ? '' : ` ${error.field}`}: ${error.message}`,
        ),
      ];
      throw new Error(`The ${label} scenario import was rejected:\n${details.join('\n')}`);
    }

    return report;
  }
}
