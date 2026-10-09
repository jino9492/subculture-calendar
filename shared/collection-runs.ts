import { GAME_IDS, isRecord, type GameId } from './calendar';

export const RUN_CAUSES = ['startup', 'scheduled', 'manual', 'request-expired'] as const;
export const RUN_STATES = ['running', 'ok', 'partial', 'stale', 'error'] as const;
export type RunCause = typeof RUN_CAUSES[number];
export type RunState = typeof RUN_STATES[number];
export interface CollectionRun {
  id: string; game: GameId; cause: RunCause; scheduledAt: string | null; startedAt: string; endedAt: string | null;
  durationMs: number; state: RunState; collected: number; merged: number; skipped: number; issues: number;
  added: number; changed: number; removedCandidates: number; hadPrevious: boolean; summary: string;
}
export interface RunContext { cause: RunCause; scheduledAt?: string; games?: GameId[] }
export interface SchedulerStatus {
  enabled: boolean; intervalMs: number; running: boolean; nextRunAt: string | null; storageError: string | null;
  games: { game: GameId; nextRunAt: string | null; lastSuccessAt: string | null; lastFailureAt: string | null; failures: number }[];
}
export interface RunPage { runs: CollectionRun[]; total: number; page: number; pageSize: number; scheduler: SchedulerStatus }
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export const isCollectionRun = (value: unknown): value is CollectionRun => isRecord(value)
  && typeof value.id === 'string' && value.id.length <= 100 && GAME_IDS.some((game) => game === value.game)
  && RUN_CAUSES.some((cause) => cause === value.cause) && RUN_STATES.some((state) => state === value.state)
  && (value.scheduledAt === null || date(value.scheduledAt)) && date(value.startedAt) && (value.endedAt === null || date(value.endedAt))
  && ['durationMs', 'collected', 'merged', 'skipped', 'issues', 'added', 'changed', 'removedCandidates'].every((key) => count(value[key]))
  && typeof value.hadPrevious === 'boolean' && typeof value.summary === 'string' && value.summary.length <= 500;
export const isRunPage = (value: unknown): value is RunPage => isRecord(value) && Array.isArray(value.runs) && value.runs.every(isCollectionRun)
  && count(value.total) && count(value.page) && count(value.pageSize) && isRecord(value.scheduler)
  && typeof value.scheduler.enabled === 'boolean' && typeof value.scheduler.running === 'boolean' && count(value.scheduler.intervalMs)
  && (value.scheduler.nextRunAt === null || date(value.scheduler.nextRunAt))
  && (value.scheduler.storageError === null || typeof value.scheduler.storageError === 'string')
  && Array.isArray(value.scheduler.games) && value.scheduler.games.every((item) => isRecord(item)
    && GAME_IDS.some((game) => game === item.game) && count(item.failures)
    && ['nextRunAt', 'lastSuccessAt', 'lastFailureAt'].every((key) => item[key] === null || date(item[key])));
