import {
  IMPACT_NOUNS,
  type ImpactCategoryBucket,
  type ImpactCategoryDto,
  type ImpactListSelector,
} from '@opsgraph/shared';

interface Column {
  bucket: ImpactCategoryBucket;
  heading: string;
  /** Spoken after the count: "6 customer orders, current". */
  phrase: string;
}

/** Spec FR-027: the Current column comes first. */
const COLUMNS: readonly Column[] = [
  { bucket: 'current', heading: 'Current', phrase: 'current' },
  { bucket: 'potential', heading: 'Potential', phrase: 'potential' },
  { bucket: 'total', heading: 'Total', phrase: 'total' },
  { bucket: 'direct', heading: 'Direct', phrase: 'direct' },
  { bucket: 'indirect', heading: 'Indirect', phrase: 'indirect' },
  { bucket: 'inferredOnly', heading: 'Only inferred', phrase: 'only inferred' },
  { bucket: 'stateUnknown', heading: 'State unknown', phrase: 'state unknown' },
];

export interface ImpactTableProps {
  categories: readonly ImpactCategoryDto[];
  onOpen: (selector: ImpactListSelector) => void;
}

export function ImpactTable({ categories, onOpen }: ImpactTableProps) {
  return (
    <table className="w-full border-collapse text-sm">
      <caption className="pb-1 text-left font-semibold">Affected entities by type</caption>
      <thead>
        <tr className="border-b text-left">
          <th scope="col" className="py-1 pr-3">
            Category
          </th>
          {COLUMNS.map((column) => (
            <th key={column.bucket} scope="col" className="px-2 py-1 text-right">
              {column.heading}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {categories.map((category) => {
          const [singular, plural] = IMPACT_NOUNS[category.type];
          return (
            <tr key={category.type} className="border-b last:border-b-0">
              <th scope="row" className="py-1 pr-3 text-left font-medium">
                {category.label}
              </th>
              {COLUMNS.map((column) => {
                const count = category[column.bucket];
                return (
                  <td key={column.bucket} className="px-2 py-1 text-right tabular-nums">
                    {count === 0 ? (
                      '0'
                    ) : (
                      <button
                        type="button"
                        aria-label={`${count} ${count === 1 ? singular : plural}, ${column.phrase}`}
                        onClick={() =>
                          onOpen({ list: 'category', type: category.type, bucket: column.bucket })
                        }
                        className="rounded px-1 font-medium underline"
                      >
                        {count}
                      </button>
                    )}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
