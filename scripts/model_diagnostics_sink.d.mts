export interface DiagnosticsPaths {
  outputDir: string;
  json: string;
  ndjson: string;
  readable: string;
}

export interface ChatRequestLogPaths {
  outputDir: string;
  latestJson: string;
  latestMd: string;
  eventsNdjson: string;
  historyDir: string;
}

export interface ChatRequestLogCleanupOptions {
  now?: number;
  retentionMs?: number;
  force?: boolean;
}

export interface ChatRequestLogCleanupResult {
  removedHistoryFiles: number;
  prunedEvents: boolean;
}

export function diagnosticsPaths(outputDir?: string): DiagnosticsPaths;
export function chatRequestLogPaths(outputDir?: string): ChatRequestLogPaths;
export function cleanupChatRequestLogs(
  paths: ChatRequestLogPaths,
  options?: ChatRequestLogCleanupOptions,
): Promise<ChatRequestLogCleanupResult>;
