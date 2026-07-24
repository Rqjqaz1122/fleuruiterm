export const CONNECTIONS_STORAGE_KEY = 'fleurterm.connections';
export const CONNECTION_PROFILES_CHANGED_EVENT = 'fleurterm:connection-profiles-changed';

export type ConnectionMethod = 'ssh' | 'telnet' | 'serial' | 'local';
export type ConnectionAuthMethod =
  'auto' | 'password' | 'publicKey' | 'agent' | 'keyboardInteractive';

export interface OpenableConnectionProfile {
  id: string;
  name: string;
  method: ConnectionMethod;
  host: string;
  user: string;
  port: number;
  shell: string;
  cwd: string;
  authMethod: ConnectionAuthMethod;
  password: string;
  hasPassword: boolean;
  privateKeys: string[];
  loginScripts: string;
  forwardedPorts: string[];
}

export interface SavedConnectionSummary {
  id: string;
  name: string;
  method: ConnectionMethod;
  host: string;
  user: string;
  port: number;
}

const CONNECTION_METHODS: ConnectionMethod[] = ['ssh', 'telnet', 'serial', 'local'];
const CONNECTION_AUTH_METHODS: ConnectionAuthMethod[] = [
  'auto',
  'password',
  'publicKey',
  'agent',
  'keyboardInteractive',
];

export function loadSavedConnectionProfiles(): OpenableConnectionProfile[] {
  if (typeof localStorage === 'undefined') {
    return [];
  }
  try {
    const storedConnections = JSON.parse(
      localStorage.getItem(CONNECTIONS_STORAGE_KEY) ?? '[]',
    ) as unknown;
    if (!Array.isArray(storedConnections)) {
      return [];
    }
    return storedConnections.flatMap((candidate) => {
      const connection = parseConnectionProfile(candidate);
      return connection === null ? [] : [connection];
    });
  } catch {
    return [];
  }
}

export function notifySavedConnectionProfilesChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(CONNECTION_PROFILES_CHANGED_EVENT));
  }
}

export function summarizeSavedConnections(
  connections: OpenableConnectionProfile[],
): SavedConnectionSummary[] {
  return connections.map(({ id, name, method, host, user, port }) => ({
    id,
    name,
    method,
    host,
    user,
    port,
  }));
}

export function findSavedConnectionProfile(
  connections: OpenableConnectionProfile[],
  target: string,
): OpenableConnectionProfile | null {
  const normalizedTarget = normalizeConnectionTarget(target);
  return (
    connections.find((connection) =>
      connectionTargets(connection).some((candidate) => candidate === normalizedTarget),
    ) ?? null
  );
}

function parseConnectionProfile(candidate: unknown): OpenableConnectionProfile | null {
  if (!isRecord(candidate)) {
    return null;
  }
  const id = stringValue(candidate.id);
  const name = stringValue(candidate.name);
  const method = connectionMethod(candidate.method);
  if (!id || !name || method === null) {
    return null;
  }
  const host = stringValue(candidate.host);
  const user = stringValue(candidate.user);
  return {
    id,
    name,
    method,
    host,
    user,
    port: connectionPort(candidate.port, method),
    shell: stringValue(candidate.shell),
    cwd: stringValue(candidate.cwd),
    authMethod: connectionAuthMethod(candidate.authMethod),
    password: '',
    hasPassword: candidate.hasPassword === true,
    privateKeys: stringArray(candidate.privateKeys),
    loginScripts: stringValue(candidate.loginScripts),
    forwardedPorts: stringArray(candidate.forwardedPorts),
  };
}

function connectionTargets(connection: OpenableConnectionProfile): string[] {
  return [
    connection.id,
    connection.name,
    connection.host,
    connection.user && connection.host ? `${connection.user}@${connection.host}` : '',
    connection.host && connection.port > 0 ? `${connection.host}:${connection.port}` : '',
  ]
    .filter(Boolean)
    .map(normalizeConnectionTarget);
}

function normalizeConnectionTarget(target: string): string {
  return target.trim().toLocaleLowerCase();
}

function connectionMethod(value: unknown): ConnectionMethod | null {
  return CONNECTION_METHODS.includes(value as ConnectionMethod)
    ? (value as ConnectionMethod)
    : null;
}

function connectionAuthMethod(value: unknown): ConnectionAuthMethod {
  return CONNECTION_AUTH_METHODS.includes(value as ConnectionAuthMethod)
    ? (value as ConnectionAuthMethod)
    : 'auto';
}

function connectionPort(value: unknown, method: ConnectionMethod): number {
  const port = Number(value);
  if (Number.isInteger(port) && port >= 0 && port <= 65_535) {
    return port;
  }
  return method === 'telnet' ? 23 : method === 'ssh' ? 22 : 0;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
