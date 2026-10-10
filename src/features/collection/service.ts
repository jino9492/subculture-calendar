import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { CollectionRun, RunContext } from '../../../shared/collection-runs';
import { GAME_IDS, isCalendarEvent, isRecord, type CalendarEvent, type CollectedCalendar, type GameId, type SourceStatus } from '../../../shared/calendar';
import { fetchGame } from './providers';
import { isCollectionIssue, type CollectionIssue } from '../../../shared/admin';
import { restoreKnownScheduleNames } from './names';
import { reconcileSchedules, resolveScheduleId } from './reconciliation';

interface Snapshot { events: CalendarEvent[]; issues: CollectionIssue[]; fetchedAt: string; skipped: number; partial: boolean; message: string }
const SNAPSHOT_VERSION = 21;
export const createCalendarCollector = (dependencies: { fetcher?: typeof fetchGame; read?: (game: GameId) => Promise<Snapshot | undefined>; write?: (game: GameId, snapshot: Snapshot) => Promise<void>; now?: () => number } = {}) => {
  const clock = dependencies.now ?? Date.now;
  const cache = new Map<GameId, Snapshot>();
  const pending = new Map<GameId, Promise<{ events: CalendarEvent[]; issues: CollectionIssue[]; source: SourceStatus }>>();
  const TTL = 15 * 60000;
  const retry = new Map<GameId, { at: number; failures: number }>();
  let runObserver: ((run: CollectionRun) => Promise<void>) | undefined;
  const observeCollectionRuns = (observer: (run: CollectionRun) => Promise<void>) => { runObserver = observer; };
  const emitRun = async (run: CollectionRun) => {
    try { await runObserver?.(run); } catch (error) { console.error('수집 실행 기록 실패', error); }
  };

  const readSnapshot = async (game: GameId): Promise<Snapshot | undefined> => {
    if (dependencies.read) return dependencies.read(game);
    try {
      const raw: unknown = JSON.parse(await readFile(new URL(`../../../.cache/${game}.json`, import.meta.url), 'utf8'));
      if (isRecord(raw) && (raw.schemaVersion === SNAPSHOT_VERSION || raw.schemaVersion === 20 || raw.schemaVersion === 19 || raw.schemaVersion === 18 || raw.schemaVersion === 17 || raw.schemaVersion === 16 || raw.schemaVersion === 15 || raw.schemaVersion === 14 || raw.schemaVersion === 13 || raw.schemaVersion === 12 || raw.schemaVersion === 11 || raw.schemaVersion === 10 || raw.schemaVersion === 9 || raw.schemaVersion === 8 || raw.schemaVersion === 7 || raw.schemaVersion === 6 || raw.schemaVersion === 5 || raw.schemaVersion === 4 || raw.schemaVersion === 3) && Array.isArray(raw.events) && raw.events.every(isCalendarEvent)
        && raw.events.every((event) => event.game === game) && typeof raw.fetchedAt === 'string'
        && Number.isFinite(Date.parse(raw.fetchedAt)) && typeof raw.skipped === 'number'
        && typeof raw.partial === 'boolean' && typeof raw.message === 'string') {
        const reconciled = reconcileSchedules(raw.events);
        return { events: reconciled.events,
          issues: [...(Array.isArray(raw.issues) && raw.issues.every(isCollectionIssue) ? raw.issues : []), ...reconciled.issues]
            .map((issue) => issue.eventId ? { ...issue, eventId: resolveScheduleId(reconciled.events, issue.eventId) } : issue),
          fetchedAt: raw.schemaVersion === SNAPSHOT_VERSION ? raw.fetchedAt : '1970-01-01T00:00:00.000Z',
          skipped: raw.skipped, partial: raw.partial, message: raw.message };
      }
    } catch (error) {
      if (!isRecord(error) || error.code !== 'ENOENT') console.error(`[${game}] cache read failed`, error);
    }
    return undefined;
  };

  const loadGame = async (game: GameId, force: boolean, context: RunContext) => {
    let snapshot = cache.get(game);
    if (!snapshot) { snapshot = await readSnapshot(game); if (snapshot) cache.set(game, snapshot); }
    if (!force && snapshot && clock() - Date.parse(snapshot.fetchedAt) < TTL) {
      return { events: snapshot.events, issues: snapshot.issues, source: { game, state: snapshot.partial ? 'partial' : 'ok',
        fetchedAt: snapshot.fetchedAt, skipped: snapshot.skipped, message: snapshot.message } satisfies SourceStatus };
    }
    if (!force && (retry.get(game)?.at ?? 0) > clock()) return { events: snapshot?.events ?? [], issues: snapshot?.issues ?? [],
      source: { game, state: snapshot ? 'stale' : 'error', fetchedAt: snapshot?.fetchedAt ?? null, skipped: snapshot?.skipped ?? 0,
        message: '갱신 실패 후 재시도 대기 중 · 마지막 수집 결과 유지' } satisfies SourceStatus };
    const started = clock();
    const run: CollectionRun = { id: randomUUID(), game, cause: context.cause, scheduledAt: context.scheduledAt ?? null,
      startedAt: new Date(started).toISOString(), endedAt: null, durationMs: 0, state: 'running', collected: 0, merged: 0,
      skipped: 0, issues: 0, added: 0, changed: 0, removedCandidates: 0, hadPrevious: Boolean(snapshot), summary: '실제 원본 수집 중' };
    await emitRun(run);
    try {
      const result = await (dependencies.fetcher ?? fetchGame)(game);
      const collected = result.events.length;
      result.events = restoreKnownScheduleNames(snapshot?.events ?? [], result.events);
      const reconciled = reconcileSchedules(result.events);
      result.events = reconciled.events;
      result.issues = [...result.issues, ...reconciled.issues].map((issue) => issue.eventId
        ? { ...issue, eventId: resolveScheduleId(result.events, issue.eventId) } : issue);
      result.partial ||= reconciled.issues.length > 0;
      result.issues = result.issues.filter((issue) => !issue.id.startsWith('translation:')
        || !result.events.some((event) => event.id === issue.eventId && event.displayLanguage === 'ko-kr'));
      const next: Snapshot = { ...result, fetchedAt: new Date(clock()).toISOString() };
      cache.set(game, next);
      try {
        if (dependencies.write) await dependencies.write(game, next); else {
        await mkdir(new URL('../../../.cache/', import.meta.url), { recursive: true });
        await writeFile(new URL(`../../../.cache/${game}.json`, import.meta.url), JSON.stringify({ ...next, schemaVersion: SNAPSHOT_VERSION }));
        }
      } catch (error) { console.error(`[${game}] cache write failed`, error); }
      retry.delete(game);
      const previous = new Map((snapshot?.events ?? []).map((event) => [event.id, event]));
      const currentIds = new Set(next.events.map((event) => event.id));
      await emitRun({ ...run, endedAt: new Date(clock()).toISOString(), durationMs: Math.max(0, clock() - started), state: next.partial ? 'partial' : 'ok',
        collected, merged: next.events.length, skipped: next.skipped, issues: new Set(next.issues.map((issue) => issue.id)).size,
        added: next.events.filter((event) => !previous.has(event.id)).length,
        changed: next.events.filter((event) => previous.has(event.id) && JSON.stringify(previous.get(event.id)) !== JSON.stringify(event)).length,
        removedCandidates: [...previous.keys()].filter((id) => !currentIds.has(id)).length,
        summary: next.partial ? '원본 수집 완료 · 누락·확인 항목은 수집 상태에서 확인' : '원본 수집 완료' });
      return { events: next.events, issues: next.issues, source: { game, state: next.partial ? 'partial' : 'ok', fetchedAt: next.fetchedAt,
        skipped: next.skipped, message: next.message } satisfies SourceStatus };
    } catch (error) {
      console.error(`[${game}] collection failed`, error);
      const failures = (retry.get(game)?.failures ?? 0) + 1;
      retry.set(game, { failures, at: clock() + Math.min(TTL * 2 ** Math.min(failures, 4), 4 * 3600000) });
      await emitRun({ ...run, endedAt: new Date(clock()).toISOString(), durationMs: Math.max(0, clock() - started), state: snapshot ? 'stale' : 'error',
        merged: snapshot?.events.length ?? 0, summary: snapshot ? '원본 갱신 실패 · 이전 데이터 유지' : '원본 수집 실패 · 다음 예약에서 재시도' });
      return { events: snapshot?.events ?? [], issues: snapshot?.issues ?? [], source: { game, state: snapshot ? 'stale' : 'error',
        fetchedAt: snapshot?.fetchedAt ?? null, skipped: snapshot?.skipped ?? 0,
        message: snapshot ? '갱신 실패 · 마지막 수집 일정을 표시합니다.' : '일정을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.' } satisfies SourceStatus };
    }
  };

  const collectCalendar = async (force = false, context: RunContext = { cause: 'request-expired' }) => {
    const results = await Promise.all((context.games ?? GAME_IDS).map((game) => {
      const existing = pending.get(game);
      if (existing) return existing;
      const promise = loadGame(game, force, context).finally(() => pending.delete(game));
      pending.set(game, promise);
      return promise;
    }));
    const calendar: CollectedCalendar = { events: [...new Map(results.flatMap((result) => result.events).map((event) => [event.id, event])).values()],
      sources: results.map((result) => result.source), server: 'Asia', displayTimeZone: 'Asia/Seoul' };
    return { calendar, issues: results.flatMap((result) => result.issues) };
  };

  return { collectCalendar, observeCollectionRuns };
};
export const { collectCalendar, observeCollectionRuns } = createCalendarCollector();
