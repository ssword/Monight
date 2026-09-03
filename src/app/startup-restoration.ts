import type {
  DocumentIntake,
  DocumentIntakeOutcome,
  RestoreSessionResult,
  StartupDocumentRequest,
} from '../reader/document-intake';
import type { PersistedReadingSession } from '../reader/reader-actions';

interface RestoreReadingSessionAtStartupOptions {
  intake: DocumentIntake;
  session: PersistedReadingSession;
  explicitRequests?: readonly StartupDocumentRequest[];
  onForegroundReady?: (outcome: DocumentIntakeOutcome) => void | Promise<void>;
  pruneDocument: (filePath: string) => Promise<void>;
  reportFailure: (message: string) => void;
}

function countLabel(count: number, label: string): string {
  return `${count} ${label}${count === 1 ? '' : 's'}`;
}

function restorationFailureSummary(result: RestoreSessionResult): string | null {
  const requestedFailures = result.explicitRequestResult.failed;
  const restoredFailures = result.failed;
  if (requestedFailures === 0 && restoredFailures === 0) return null;
  if (requestedFailures === 0) {
    return `Pruned ${countLabel(restoredFailures, 'saved Document')} while restoring the Reading Session.`;
  }
  if (restoredFailures === 0) {
    return `Failed to open ${countLabel(requestedFailures, 'requested Document')} during Reading Session restoration.`;
  }
  return `Failed to open ${countLabel(requestedFailures, 'requested Document')} and pruned ${countLabel(restoredFailures, 'saved Document')} while restoring the Reading Session.`;
}

export async function restoreReadingSessionAtStartup({
  intake,
  session,
  explicitRequests = [],
  onForegroundReady,
  pruneDocument,
  reportFailure,
}: RestoreReadingSessionAtStartupOptions): Promise<RestoreSessionResult> {
  const operation = intake.beginRestore(session, { explicitRequests });
  const foreground = await operation.foreground;
  if (foreground) await onForegroundReady?.(foreground);
  const result = await operation.completion;
  for (const filePath of result.failedPaths) {
    await pruneDocument(filePath);
  }
  const summary = restorationFailureSummary(result);
  if (summary) reportFailure(summary);
  return result;
}
