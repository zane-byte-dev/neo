/**
 * src/runtime/index.ts — Public surface of the runtime persistence layer.
 *
 * Re-exports the subset that other layers (services, routes, executor)
 * are expected to consume. Implementation files stay free to add
 * internal helpers without breaking the import shape.
 */

export * from './types.js';
export {
    runDir,
    runFilePath,
    eventsFilePath,
    checkpointFilePath,
    pendingFilePath,
    artifactsDir,
    runsRoot,
} from './paths.js';
export {
    createRun,
    loadRun,
    saveRun,
    updateRunStatus,
    listRunIds,
    newRunId,
    type CreateRunInput,
} from './store.js';
export {
    appendEvent,
    listRunEvents,
    lastEventIndex,
    type AppendEventOptions,
    type ListEventsOptions,
} from './events.js';
export {
    saveCheckpoint,
    loadCheckpoint,
} from './checkpoint.js';
export {
    appendRunEventSafe,
    updateRunStatusSafe,
    saveRunCheckpointSafe,
    bumpRunMetrics,
    previewText,
    startCancellationProbe,
    type CancellationProbe,
} from './executor.js';
export {
    sweepUserWorkspace,
    sweepAllUserWorkspaces,
    SWEEPABLE_STATUSES,
    type SweepResult,
} from './sweeper.js';
export {
    savePendingAction,
    loadPendingAction,
    resolvePendingAction,
    expirePendingAction,
    clearPendingAction,
    type CreatePendingActionInput,
    type ResolvePendingActionInput,
} from './pending-actions.js';
