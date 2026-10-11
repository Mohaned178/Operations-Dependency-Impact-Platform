import {
  IMPACT_NOUNS,
  type ExposureFigureDto,
  type ExposureShareDto,
  type ImpactExposureBucket,
  type ImpactListSelector,
  type ImpactResponse,
} from '@opsgraph/shared';
import { formatMoney } from '../../../lib/format';

const [ORDER_SINGULAR, ORDER_PLURAL] = IMPACT_NOUNS.Order;
const orderNoun = (count: number): string => (count === 1 ? ORDER_SINGULAR : ORDER_PLURAL);

interface FigureButtonProps {
  label: string;
  currency: string;
  share: ExposureShareDto;
  onOpen: () => void;
}

/** A share is a button when it holds orders, plain text otherwise. */
function Share({ label, currency, share, onOpen }: FigureButtonProps) {
  const text = `${label} ${formatMoney(share.amount, currency)} (${share.orderCount} ${orderNoun(share.orderCount)})`;
  return share.orderCount === 0 ? (
    <span>{text}</span>
  ) : (
    <button type="button" onClick={onOpen} className="rounded underline">
      {text}
    </button>
  );
}

function Figure({
  figure,
  onOpen,
}: {
  figure: ExposureFigureDto;
  onOpen: (selector: ImpactListSelector) => void;
}) {
  const open = (bucket: ImpactExposureBucket) => () =>
    onOpen({ list: 'exposure', currency: figure.currency, bucket });

  return (
    <div className="flex flex-col gap-1 rounded border bg-white p-3 text-sm">
      <h3 className="font-semibold">{`Exposure in ${figure.currency}`}</h3>
      <p className="flex flex-wrap gap-x-4 gap-y-1">
        <Share label="Total" currency={figure.currency} share={figure.total} onOpen={open('total')} />
        <Share label="Current" currency={figure.currency} share={figure.current} onOpen={open('current')} />
        <Share label="Potential" currency={figure.currency} share={figure.potential} onOpen={open('potential')} />
      </p>
      {figure.inferredOnly.total.orderCount > 0 ? (
        <p>
          <Share
            label="Of which reached only through inferred links:"
            currency={figure.currency}
            share={figure.inferredOnly.total}
            onOpen={open('inferredOnly')}
          />
        </p>
      ) : null}
      {figure.range !== null ? (
        <p>
          {`Source values disagree on ${figure.disagreementOrderCount} ${orderNoun(figure.disagreementOrderCount)}: exposure is between ${formatMoney(figure.range.low, figure.currency)} and ${formatMoney(figure.range.high, figure.currency)}.`}
        </p>
      ) : null}
    </div>
  );
}

export interface ExposureFiguresProps {
  exposure: ImpactResponse['exposure'];
  notCounted: ImpactResponse['notCounted'];
  onOpen: (selector: ImpactListSelector) => void;
}

export function ExposureFigures({ exposure, notCounted, onOpen }: ExposureFiguresProps) {
  const { valueUnknownCount } = exposure;
  if (exposure.byCurrency.length === 0 && valueUnknownCount === 0 && notCounted.total === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      {exposure.byCurrency.map((figure) => (
        <Figure key={figure.currency} figure={figure} onOpen={onOpen} />
      ))}

      {valueUnknownCount > 0 ? (
        <p className="text-sm">
          <button type="button" onClick={() => onOpen({ list: 'valueUnknown' })} className="rounded underline">
            {`${valueUnknownCount} ${orderNoun(valueUnknownCount)} without a recorded value`}
          </button>
          {` ${valueUnknownCount === 1 ? 'is' : 'are'} left out of exposure.`}
        </p>
      ) : null}

      {notCounted.total > 0 ? (
        <p className="text-sm">
          <button
            type="button"
            onClick={() => onOpen({ list: 'notCounted', type: null })}
            className="rounded underline"
          >
            {`${notCounted.total} completed or cancelled ${notCounted.total === 1 ? 'entity' : 'entities'}`}
          </button>
          {` ${notCounted.total === 1 ? 'is' : 'are'} not counted.`}
        </p>
      ) : null}
    </div>
  );
}
