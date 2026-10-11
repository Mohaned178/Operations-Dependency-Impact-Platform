import { createContext, useContext } from 'react';

export type ExplorerActions = { toggleExpand: (entityId: string) => void };

export const ExplorerActionsContext = createContext<ExplorerActions | null>(null);

/** Actions that graph nodes can trigger. Throws outside an ExplorerActionsContext provider. */
export function useExplorerActions(): ExplorerActions {
  const actions = useContext(ExplorerActionsContext);
  if (actions === null) {
    throw new Error('useExplorerActions must be used inside an ExplorerActionsContext provider');
  }
  return actions;
}
