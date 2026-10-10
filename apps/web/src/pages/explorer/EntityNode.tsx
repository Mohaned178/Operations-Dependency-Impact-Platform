import { Handle, Position, type NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { StateBadge } from '../entities/StateBadge';
import { useExplorerActions } from './explorer-actions';
import type { EntityFlowNode } from './flow-types';
import { NodeChips } from './NodeChips';

const HANDLE = '!h-px !w-px !min-h-0 !min-w-0 !border-0 !bg-transparent';
const BASE = 'relative h-[76px] w-[240px] rounded-md border bg-white px-3 py-2 text-left shadow-sm';

function nodeClass(input: {
  isFocus: boolean;
  isConnector: boolean;
  emphasis: EntityFlowNode['data']['emphasis'];
  selected: boolean;
}): string {
  const { isFocus, isConnector, emphasis, selected } = input;
  const parts = [BASE];
  if (isFocus) {
    parts.push('border-2 border-blue-600', selected ? 'ring-4 ring-blue-300' : 'ring-4 ring-blue-100');
  } else if (selected) {
    parts.push('ring-2 ring-blue-500');
  }
  if (isConnector) {
    parts.push('border-dashed bg-slate-50');
    if (emphasis !== 'dimmed') {
      parts.push('opacity-70');
    }
  }
  if (emphasis === 'highlighted') {
    parts.push('border-2 border-red-600');
  } else if (!isFocus) {
    parts.push('border-slate-300');
  }
  if (emphasis === 'dimmed') {
    parts.push('opacity-20');
  }
  return parts.join(' ');
}

function ExpandButton({ id, name, expanded }: { id: string; name: string; expanded: boolean }) {
  const { toggleExpand } = useExplorerActions();
  return (
    <button
      type="button"
      className="nodrag nopan absolute bottom-1 right-1 h-5 w-5 rounded border border-slate-300 bg-white text-xs leading-none"
      aria-label={`${expanded ? 'Collapse' : 'Expand'} ${name}`}
      onClick={(event) => {
        event.stopPropagation();
        toggleExpand(id);
      }}
    >
      {expanded ? '−' : '+'}
    </button>
  );
}

export const EntityNode = memo(function EntityNode({ data, selected }: NodeProps<EntityFlowNode>) {
  const { entity, isFocus, isConnector, emphasis } = data;
  return (
    <div className={nodeClass({ isFocus, isConnector, emphasis, selected })}>
      <Handle type="target" position={Position.Left} id="in-left" isConnectable={false} className={HANDLE} />
      <Handle type="source" position={Position.Left} id="out-left" isConnectable={false} className={HANDLE} />
      <Handle type="target" position={Position.Right} id="in-right" isConnectable={false} className={HANDLE} />
      <Handle type="source" position={Position.Right} id="out-right" isConnectable={false} className={HANDLE} />
      <p className="truncate text-[10px] font-medium uppercase tracking-wide text-slate-500">
        {entity.type}
        {isFocus ? ' · Focus' : ''}
      </p>
      <p className="truncate text-sm font-medium text-slate-900">{entity.displayName}</p>
      <div className="mt-1 flex items-center gap-1 overflow-hidden">
        <StateBadge state={entity.currentState} />
        <NodeChips node={entity} blockerRole={data.blockerRole} />
      </div>
      {data.canExpand ? (
        <ExpandButton id={entity.id} name={entity.displayName} expanded={entity.expanded} />
      ) : null}
    </div>
  );
});
