export type SplitDirection = 'horizontal' | 'vertical';
export type IdGenerator = () => string;

export interface TerminalPaneNode {
  kind: 'pane';
  id: string;
  sessionId: string;
}

export interface TerminalSplitNode {
  kind: 'split';
  id: string;
  direction: SplitDirection;
  children: [TerminalNode, TerminalNode];
}

export type TerminalNode = TerminalPaneNode | TerminalSplitNode;

export interface TerminalTab {
  id: string;
  title: string;
  root: TerminalNode;
}

export interface WorkspaceState {
  tabs: TerminalTab[];
  activeTabId: string | null;
  focusedPaneId: string | null;
  focusedSessionId: string | null;
}

export class WorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceError';
  }
}

const defaultIdGenerator: IdGenerator = () => crypto.randomUUID();

export function createWorkspace(
  sessionId: string,
  generateId: IdGenerator = defaultIdGenerator,
): WorkspaceState {
  const tabId = generateId();
  const pane = createPane(sessionId, generateId);
  return {
    tabs: [{ id: tabId, title: 'Local Terminal 1', root: pane }],
    activeTabId: tabId,
    focusedPaneId: pane.id,
    focusedSessionId: pane.sessionId,
  };
}

export function addTab(
  workspace: WorkspaceState,
  sessionId: string,
  generateId: IdGenerator = defaultIdGenerator,
): WorkspaceState {
  const tabId = generateId();
  const pane = createPane(sessionId, generateId);
  const tab: TerminalTab = {
    id: tabId,
    title: `Local Terminal ${workspace.tabs.length + 1}`,
    root: pane,
  };
  return {
    tabs: [...workspace.tabs, tab],
    activeTabId: tabId,
    focusedPaneId: pane.id,
    focusedSessionId: pane.sessionId,
  };
}

export function activateTab(workspace: WorkspaceState, tabId: string): WorkspaceState {
  const tab = findTab(workspace, tabId);
  const pane = firstPane(tab.root);
  return {
    ...workspace,
    activeTabId: tab.id,
    focusedPaneId: pane.id,
    focusedSessionId: pane.sessionId,
  };
}

export function focusPane(workspace: WorkspaceState, paneId: string): WorkspaceState {
  const owningTab = workspace.tabs.find((tab) => containsPane(tab.root, paneId));
  if (owningTab === undefined) {
    throw new WorkspaceError(`unknown pane: ${paneId}`);
  }
  const pane = findPaneInNode(owningTab.root, paneId);
  if (pane === null) {
    throw new WorkspaceError(`unknown pane: ${paneId}`);
  }
  return {
    ...workspace,
    activeTabId: owningTab.id,
    focusedPaneId: pane.id,
    focusedSessionId: pane.sessionId,
  };
}

export function splitPane(
  workspace: WorkspaceState,
  paneId: string | null,
  direction: SplitDirection,
  sessionId: string,
  generateId: IdGenerator = defaultIdGenerator,
): WorkspaceState {
  if (paneId === null) {
    throw new WorkspaceError('cannot split without a focused pane');
  }

  const splitId = generateId();
  const newPane = createPane(sessionId, generateId);
  const replacement: TerminalSplitNode = {
    kind: 'split',
    id: splitId,
    direction,
    children: [findPane(workspace, paneId), newPane],
  };
  const tabs = workspace.tabs.map((tab) => ({
    ...tab,
    root: replacePane(tab.root, paneId, replacement),
  }));
  return {
    tabs,
    activeTabId: workspace.activeTabId,
    focusedPaneId: newPane.id,
    focusedSessionId: newPane.sessionId,
  };
}

export function closePane(workspace: WorkspaceState, paneId: string): WorkspaceState {
  const owningTab = workspace.tabs.find((tab) => containsPane(tab.root, paneId));
  if (owningTab === undefined) {
    throw new WorkspaceError(`unknown pane: ${paneId}`);
  }

  const remainingRoot = removePane(owningTab.root, paneId);
  if (remainingRoot === null) {
    return closeTab(workspace, owningTab.id);
  }

  const tabs = workspace.tabs.map((tab) =>
    tab.id === owningTab.id ? { ...tab, root: remainingRoot } : tab,
  );
  if (owningTab.id !== workspace.activeTabId) {
    return { ...workspace, tabs };
  }

  const pane = firstPane(remainingRoot);
  return {
    tabs,
    activeTabId: workspace.activeTabId,
    focusedPaneId: pane.id,
    focusedSessionId: pane.sessionId,
  };
}

export function closeTab(workspace: WorkspaceState, tabId: string): WorkspaceState {
  const closingIndex = workspace.tabs.findIndex((tab) => tab.id === tabId);
  if (closingIndex < 0) {
    throw new WorkspaceError(`unknown tab: ${tabId}`);
  }

  const tabs = workspace.tabs.filter((tab) => tab.id !== tabId);
  if (tabs.length === 0) {
    return emptyWorkspace();
  }
  if (workspace.activeTabId !== tabId) {
    return { ...workspace, tabs };
  }

  const nextTab = tabs[Math.min(closingIndex, tabs.length - 1)];
  if (nextTab === undefined) {
    return emptyWorkspace();
  }
  const pane = firstPane(nextTab.root);
  return {
    tabs,
    activeTabId: nextTab.id,
    focusedPaneId: pane.id,
    focusedSessionId: pane.sessionId,
  };
}

function createPane(sessionId: string, generateId: IdGenerator): TerminalPaneNode {
  return {
    kind: 'pane',
    id: generateId(),
    sessionId,
  };
}

function findTab(workspace: WorkspaceState, tabId: string): TerminalTab {
  const tab = workspace.tabs.find((candidate) => candidate.id === tabId);
  if (tab === undefined) {
    throw new WorkspaceError(`unknown tab: ${tabId}`);
  }
  return tab;
}

function findPane(workspace: WorkspaceState, paneId: string): TerminalPaneNode {
  for (const tab of workspace.tabs) {
    const pane = findPaneInNode(tab.root, paneId);
    if (pane !== null) {
      return pane;
    }
  }
  throw new WorkspaceError(`unknown pane: ${paneId}`);
}

function findPaneInNode(node: TerminalNode, paneId: string): TerminalPaneNode | null {
  if (node.kind === 'pane') {
    return node.id === paneId ? node : null;
  }
  return findPaneInNode(node.children[0], paneId) ?? findPaneInNode(node.children[1], paneId);
}

function replacePane(node: TerminalNode, paneId: string, replacement: TerminalNode): TerminalNode {
  if (node.kind === 'pane') {
    return node.id === paneId ? replacement : node;
  }
  return {
    ...node,
    children: [
      replacePane(node.children[0], paneId, replacement),
      replacePane(node.children[1], paneId, replacement),
    ],
  };
}

function removePane(node: TerminalNode, paneId: string): TerminalNode | null {
  if (node.kind === 'pane') {
    return node.id === paneId ? null : node;
  }

  const first = removePane(node.children[0], paneId);
  const second = removePane(node.children[1], paneId);
  if (first === null) {
    return second;
  }
  if (second === null) {
    return first;
  }
  return { ...node, children: [first, second] };
}

function containsPane(node: TerminalNode, paneId: string): boolean {
  return findPaneInNode(node, paneId) !== null;
}

function firstPane(node: TerminalNode): TerminalPaneNode {
  return node.kind === 'pane' ? node : firstPane(node.children[0]);
}

function emptyWorkspace(): WorkspaceState {
  return {
    tabs: [],
    activeTabId: null,
    focusedPaneId: null,
    focusedSessionId: null,
  };
}
