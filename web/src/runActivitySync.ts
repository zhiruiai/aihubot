import type { Bootstrap, RunActivity } from '../../shared/types';

const categories = new Set<RunActivity>([
  'research',
  'files',
  'website',
  'skill',
  'collaborating',
  'connectedApp',
  'computer',
]);

export type RunActivityUpdate = {
  runId: string;
  revision: number;
  activity: RunActivity | null;
};

export function parseRunActivityUpdate(data: unknown): RunActivityUpdate | undefined {
  if (!data || typeof data !== 'object') return;
  const { runId, revision, activity } = data as Partial<RunActivityUpdate>;
  if (
    typeof runId === 'string' &&
    runId.length > 0 &&
    runId.length <= 80 &&
    typeof revision === 'number' &&
    Number.isSafeInteger(revision) &&
    revision > 0 &&
    (activity === null || (activity !== undefined && categories.has(activity)))
  )
    return { runId, revision, activity };
}

export function mergeRunActivity<T extends Bootstrap | null>(
  snapshot: T,
  updates: ReadonlyMap<string, RunActivityUpdate>,
): T {
  if (!snapshot?.runningRequests?.length || !updates.size) return snapshot;
  let changed = false;
  const runningRequests = snapshot.runningRequests.map((run) => {
    const update = run.runId && updates.get(run.runId);
    if (!update || update.revision <= (run.activityRevision ?? 0)) return run;
    changed = true;
    return {
      ...run,
      activity: update.activity ?? undefined,
      activityRevision: update.revision,
    };
  });
  return changed ? { ...snapshot, runningRequests } : snapshot;
}
