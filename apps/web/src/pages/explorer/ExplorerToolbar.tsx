import {
  EXPLORER_LIMITS,
  EntityTypeSchema,
  RelationshipTypeSchema,
  TRACEABLE_RELATIONSHIP_TYPES,
  type EntityType,
  type ExplorerUrlParams,
  type NeighborhoodDirection,
  type RelationshipType,
} from '@opsgraph/shared';
import { useRef } from 'react';
import { useSearchParams } from 'react-router';
import { writeExplorerParams } from './explorer-params';

export interface ExplorerToolbarProps {
  params: ExplorerUrlParams;
}

const STEP_OPTIONS = Array.from(
  { length: EXPLORER_LIMITS.maxDepth - EXPLORER_LIMITS.minDepth + 1 },
  (_, i) => EXPLORER_LIMITS.minDepth + i,
);

const DIRECTIONS: ReadonlyArray<{ value: NeighborhoodDirection; label: string }> = [
  { value: 'all', label: 'All directions' },
  { value: 'upstream', label: 'Upstream only' },
  { value: 'downstream', label: 'Downstream only' },
];

interface TypeChecklistProps<T extends string> {
  title: string;
  options: readonly T[];
  selected: readonly T[];
  onChange: (next: T[]) => void;
}

/** A collapsible checklist; the selection is kept in option order. Empty = no filter. */
function TypeChecklist<T extends string>({
  title,
  options,
  selected,
  onChange,
}: TypeChecklistProps<T>) {
  return (
    <details className="relative">
      <summary className="cursor-pointer select-none rounded border border-gray-300 px-2 py-1">
        {`${title} (${selected.length})`}
      </summary>
      <div className="absolute z-20 mt-1 flex w-56 flex-col gap-1 rounded border bg-white p-2 shadow-lg">
        {options.map((option) => (
          <label key={option} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={selected.includes(option)}
              onChange={(event) => {
                onChange(
                  options.filter((candidate) =>
                    candidate === option ? event.target.checked : selected.includes(candidate),
                  ),
                );
              }}
            />
            {option}
          </label>
        ))}
        <button
          type="button"
          aria-label={`Clear ${title.toLowerCase()}`}
          onClick={() => {
            onChange([]);
          }}
          className="mt-1 self-start rounded border px-2 py-0.5 text-xs"
        >
          Clear
        </button>
      </div>
    </details>
  );
}

/** Contract ui.md §11: every control writes the URL (replace, defaults omitted). */
export function ExplorerToolbar({ params }: ExplorerToolbarProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const radios = useRef<Array<HTMLButtonElement | null>>([]);

  const update = (partial: Partial<ExplorerUrlParams>): void => {
    setSearchParams(writeExplorerParams(searchParams, partial), { replace: true });
  };

  const relationshipOptions: readonly RelationshipType[] =
    params.direction === 'all' ? RelationshipTypeSchema.options : TRACEABLE_RELATIONSHIP_TYPES;

  const chooseDirection = (direction: NeighborhoodDirection): void => {
    // RELATES_TO has no dependency direction, so it cannot be followed upstream or downstream.
    update(
      direction === 'all'
        ? { direction }
        : {
            direction,
            relationshipTypes: params.relationshipTypes.filter((type) => type !== 'RELATES_TO'),
          },
    );
  };

  // ARIA radio pattern: only the checked radio is a Tab stop; the arrow keys move and check.
  const onRadioKeyDown = (event: React.KeyboardEvent, index: number): void => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0) {
      return;
    }
    event.preventDefault();
    const next = (index + step + DIRECTIONS.length) % DIRECTIONS.length;
    const target = DIRECTIONS[next];
    if (target !== undefined) {
      chooseDirection(target.value);
      radios.current[next]?.focus();
    }
  };

  return (
    <div
      className="flex flex-wrap items-center gap-4 text-sm"
      role="toolbar"
      aria-label="Explorer settings"
    >
      <div role="radiogroup" aria-label="Direction" className="flex overflow-hidden rounded border">
        {DIRECTIONS.map(({ value, label }, index) => (
          <button
            key={value}
            ref={(element) => {
              radios.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={params.direction === value}
            tabIndex={params.direction === value ? 0 : -1}
            onKeyDown={(event) => {
              onRadioKeyDown(event, index);
            }}
            onClick={() => {
              chooseDirection(value);
            }}
            className="px-3 py-1 aria-checked:bg-slate-800 aria-checked:text-white"
          >
            {label}
          </button>
        ))}
      </div>

      <label className="flex items-center gap-2">
        Steps
        <select
          value={params.depth}
          onChange={(event) => {
            update({ depth: Number(event.target.value) });
          }}
          className="rounded border border-gray-300 px-2 py-1"
        >
          {STEP_OPTIONS.map((depth) => (
            <option key={depth} value={depth}>
              {depth}
            </option>
          ))}
        </select>
      </label>

      <TypeChecklist<EntityType>
        title="Entity types"
        options={EntityTypeSchema.options}
        selected={params.entityTypes}
        onChange={(entityTypes) => {
          update({ entityTypes });
        }}
      />

      <TypeChecklist<RelationshipType>
        title="Relationship types"
        options={relationshipOptions}
        selected={params.relationshipTypes}
        onChange={(relationshipTypes) => {
          update({ relationshipTypes });
        }}
      />

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={params.blockers}
          onChange={(event) => {
            update({ blockers: event.target.checked });
          }}
        />
        Highlight blockers
      </label>
    </div>
  );
}
