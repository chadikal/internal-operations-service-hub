const KNOWN_NODE_ENVS = new Set(['development', 'test', 'production']);

export function startupLogLine(
  nodeEnv: string | undefined,
  port: number,
  trustProxy: boolean,
): string {
  const envLabel =
    nodeEnv !== undefined && KNOWN_NODE_ENVS.has(nodeEnv) ? nodeEnv : nodeEnv ? 'invalid' : 'unset';
  return `Application started NODE_ENV=${envLabel} port=${port} trustProxy=${trustProxy}`;
}
