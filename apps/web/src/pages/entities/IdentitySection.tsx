import type { EntityDetailDto, JsonValue } from '@opsgraph/shared';
import { formatMoney, formatTimestamp } from '../../lib/format';

export interface IdentitySectionProps {
  entity: EntityDetailDto;
}

function attributeValue(value: JsonValue): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export function IdentitySection({ entity }: IdentitySectionProps) {
  const amount = entity.attributes.amount;
  const currency = entity.attributes.currency;
  const hasMoney = typeof amount === 'string' && typeof currency === 'string';
  const attributes = Object.entries(entity.attributes).filter(
    ([key]) => !(hasMoney && (key === 'amount' || key === 'currency')),
  );

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">Identity</h2>

      <ul className="flex flex-col gap-1 text-sm">
        {entity.identifiers.map((identifier) => (
          <li key={`${identifier.sourceSystem}/${identifier.sourceId}`}>
            <span className="font-medium">
              {identifier.sourceSystem} · {identifier.sourceId}
            </span>
            <span className="text-slate-500">
              {' '}
              · first seen {formatTimestamp(identifier.firstSeenAt)}
            </span>
          </li>
        ))}
      </ul>

      <h3 className="text-sm font-semibold">Attributes</h3>
      {attributes.length === 0 && !hasMoney ? (
        <p className="text-sm text-slate-500">No attributes</p>
      ) : (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          {hasMoney ? (
            <>
              <dt className="text-slate-500">amount</dt>
              <dd>{formatMoney(amount, currency)}</dd>
            </>
          ) : null}
          {attributes.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-slate-500">{key}</dt>
              <dd>{attributeValue(value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
