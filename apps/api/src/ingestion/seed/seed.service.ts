import { Injectable } from '@nestjs/common';
import type { ImportReport } from '@opsgraph/shared';
import { RequestContext } from '../../common/context/request-context';
import { ImportService } from '../import.service';
import { buildScenario39Document } from './scenario-39';

@Injectable()
export class SeedService {
  constructor(
    private readonly imports: ImportService,
    private readonly requestContext: RequestContext,
  ) {}

  async seedScenario39(): Promise<ImportReport | null> {
    const content = Buffer.from(JSON.stringify(buildScenario39Document()), 'utf8');

    const report = await this.requestContext.runDetached(() =>
      this.imports.run({
        format: 'json',
        fileName: 'scenario-39.json',
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
      throw new Error(`The §39 scenario import was rejected:\n${details.join('\n')}`);
    }

    return report;
  }
}
