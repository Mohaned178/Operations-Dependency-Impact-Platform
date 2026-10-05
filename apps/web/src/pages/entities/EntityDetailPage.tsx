import { useQuery } from '@tanstack/react-query';
import { EntityDetailDtoSchema } from '@opsgraph/shared';
import { Link, useParams } from 'react-router';
import { ApiError, apiFetch } from '../../lib/api-client';
import { CurrentStateSection } from './CurrentStateSection';
import { IdentitySection } from './IdentitySection';
import { RelationshipsSection } from './RelationshipsSection';
import { SourceRecordsSection } from './SourceRecordsSection';
import { StateBadge } from './StateBadge';
import { TimelineSection } from './TimelineSection';

function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

export function EntityDetailPage() {
  const { id = '' } = useParams();

  const entityQuery = useQuery({
    queryKey: ['entities', id],
    queryFn: () => apiFetch(`/entities/${id}`, { schema: EntityDetailDtoSchema }),
    enabled: id !== '',
  });

  if (entityQuery.isPending) {
    return <p>Loading…</p>;
  }

  if (entityQuery.isError) {
    return (
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Entity</h1>
        {isNotFound(entityQuery.error) ? (
          <p>
            Entity not found. <Link to="/entities">Back to entities</Link>
          </p>
        ) : (
          <p role="alert">Unable to load this entity.</p>
        )}
      </section>
    );
  }

  const entity = entityQuery.data;

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-slate-500">{entity.type}</p>
        <h1 className="text-2xl font-semibold">{entity.displayName}</h1>
        <div>
          <StateBadge state={entity.currentState} />
        </div>
      </header>

      <IdentitySection entity={entity} />
      <CurrentStateSection entity={entity} />
      <RelationshipsSection entityId={entity.id} />
      <TimelineSection entityId={entity.id} />
      <SourceRecordsSection entityId={entity.id} />
    </section>
  );
}
