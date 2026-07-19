type DiagnosticDebugGlobal = typeof globalThis & {
  __MOON_TAB_DEBUG__?: boolean;
};

export function isDiagnosticDebugEnabled(): boolean {
  return isDevelopmentBuild() || (globalThis as DiagnosticDebugGlobal).__MOON_TAB_DEBUG__ === true;
}

export function diagnosticDebug(prefix: string, message: string, details?: unknown): void {
  if (!isDiagnosticDebugEnabled()) {
    return;
  }

  if (details === undefined) {
    console.debug(`${prefix} ${message}`);
    return;
  }

  console.debug(`${prefix} ${message}`, details);
}

function isDevelopmentBuild(): boolean {
  const meta = import.meta as ImportMeta & { env?: { DEV?: boolean } };
  return meta.env?.DEV === true;
}
