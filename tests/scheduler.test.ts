import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CollectionScheduler } from '../server/collection-scheduler';
import { RunStore } from '../server/run-store';
import { createCalendarCollector } from '../src/features/collection';
import { isRunPage, type CollectionRun } from '../shared/collection-runs';
import type { CalendarEvent, GameId } from '../shared/calendar';

const start = Date.parse('2099-01-01T00:00:00Z');
const event = (id: string, game: GameId = 'genshin'): CalendarEvent => ({ id, game, kind: 'event', title: id,
  startAt: new Date(start).toISOString(), endAt: new Date(start + 10 * 86400000).toISOString(), sourceLanguage: 'ko-kr',
  description: '', sourceUrl: 'https://example.com/source' });
const run = (id: string, state: CollectionRun['state'] = 'ok', at = start): CollectionRun => ({ id, game: 'genshin', cause: 'scheduled',
  scheduledAt: new Date(at).toISOString(), startedAt: new Date(at).toISOString(), endedAt: new Date(at + 1).toISOString(), durationMs: 1,
  state, collected: 0, merged: 0, skipped: 0, issues: 0, added: 0, changed: 0, removedCandidates: 0, hadPrevious: false, summary: '테스트' });
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const fakeClock = () => {
  let at = start; let sequence = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return { now: () => at, set: (fn: () => void, delay: number) => { const id = ++sequence; timers.set(id, { at: at + delay, fn }); return id; },
    clear: (key: unknown) => { if (typeof key === 'number') timers.delete(key); }, count: () => timers.size,
    advance: (amount: number) => { at += amount; for (const [id, timer] of [...timers]) if (timer.at <= at) { timers.delete(id); timer.fn(); } } };
};
test('스케줄러는 완료 후 예약하고 긴 수집·절전 구간에 중복 실행하지 않음', async () => {
  const clock = fakeClock(); let calls = 0; let finish: () => void = () => {};
  const scheduler = new CollectionScheduler(async (games, scheduledAt) => {
    calls++; assert.equal(games.length, 5); assert.equal(scheduledAt, new Date(start + 100).toISOString());
    await new Promise<void>((resolve) => { finish = resolve; });
  }, clock, 100);
  scheduler.start(); clock.advance(1000); await tick();
  assert.equal(calls, 1); assert.equal(scheduler.status().running, true); assert.equal(clock.count(), 0);
  clock.advance(10000); assert.equal(calls, 1);
  finish(); await tick(); assert.equal(clock.count(), 1); assert.equal(scheduler.status().running, false);
  assert.equal(scheduler.status().nextRunAt, new Date(clock.now() + 100).toISOString());
  scheduler.stop(); clock.advance(1000); assert.equal(calls, 1); assert.equal(clock.count(), 0);
});
test('게임별 실패 간격은 늘어나고 성공 게임은 정상 주기로 계속 실행', async () => {
  const clock = fakeClock(); const batches: string[][] = [];
  const scheduler = new CollectionScheduler(async (games) => {
    batches.push(games); for (const game of games) scheduler.update({ ...run(game, game === 'genshin' ? 'stale' : 'ok', clock.now()), game });
  }, clock, 100);
  scheduler.start(); clock.advance(100); await tick();
  assert.equal(scheduler.status().games.find((item) => item.game === 'genshin')?.failures, 1);
  clock.advance(100); await tick(); assert.ok(!batches[1]?.includes('genshin'));
  clock.advance(100); await tick(); assert.ok(batches[2]?.includes('genshin'));
  scheduler.update(run('manual-success', 'ok', clock.now()));
  assert.equal(scheduler.status().games.find((item) => item.game === 'genshin')?.failures, 0);
  scheduler.stop();
});
test('자동·수동 수집 합류는 한 번만 기록하고 유효 캐시는 새 성공을 기록하지 않음', async () => {
  let calls = 0; let finish: () => void = () => {}; const logs: CollectionRun[] = [];
  const collector = createCalendarCollector({ now: () => start, read: async () => undefined, write: async () => {},
    fetcher: async () => { calls++; await new Promise<void>((resolve) => { finish = resolve; }); return { events: [], issues: [], partial: false, skipped: 0, message: '성공' }; } });
  collector.observeCollectionRuns(async (item) => { logs.push(item); });
  const first = collector.collectCalendar(true, { cause: 'scheduled', games: ['genshin'], scheduledAt: new Date(start).toISOString() });
  await tick(); const joined = collector.collectCalendar(true, { cause: 'manual', games: ['genshin'] });
  finish(); await Promise.all([first, joined]);
  assert.equal(calls, 1); assert.equal(logs.length, 2); assert.equal(new Set(logs.map((item) => item.id)).size, 1);
  assert.equal(logs[1]?.cause, 'scheduled'); assert.equal(logs[1]?.state, 'ok');
  await collector.collectCalendar(false, { cause: 'request-expired', games: ['genshin'] });
  assert.equal(calls, 1); assert.equal(logs.length, 2);
});
test('게임별 실패는 다른 게임 수집을 막지 않고 이전 자료·재시도 대기 상태 유지', async () => {
  let at = start; let calls = 0; let failure = false;
  const collector = createCalendarCollector({ now: () => at, read: async () => undefined, write: async () => {},
    fetcher: async (game) => { calls++; if (failure && game === 'genshin') throw new Error('secret=https://private?token=123'); return { events: [event(game, game)], issues: [], partial: false, skipped: 0, message: '성공' }; } });
  const logs: CollectionRun[] = []; collector.observeCollectionRuns(async (item) => { logs.push(item); });
  await collector.collectCalendar(true, { cause: 'startup', games: ['genshin', 'wuwa'] });
  at += 900001; failure = true;
  const result = await collector.collectCalendar(false, { cause: 'request-expired', games: ['genshin', 'wuwa'] });
  assert.deepEqual(result.calendar.sources.map((source) => source.state), ['stale', 'ok']);
  assert.ok(result.calendar.events.some((item) => item.id === 'genshin'));
  const before = calls; await collector.collectCalendar(false, { cause: 'request-expired', games: ['genshin'] });
  assert.equal(calls, before); assert.ok(!JSON.stringify(logs).includes('token=123'));
  at += 1800001; await collector.collectCalendar(false, { cause: 'request-expired', games: ['genshin'] }); assert.equal(calls, before + 1);
});

test('실행 로그의 수집·병합·제외·변경 후보 개수는 실제 결과로 계산', async () => {
  let events = [event('a'), event('b')]; const logs: CollectionRun[] = [];
  const collector = createCalendarCollector({ now: () => start, read: async () => undefined, write: async () => {},
    fetcher: async () => ({ events, issues: [], skipped: 2, partial: false, message: '성공' }) });
  collector.observeCollectionRuns(async (item) => { logs.push(item); });
  await collector.collectCalendar(true, { cause: 'startup', games: ['genshin'] });
  events = [{ ...event('a'), title: '보정된 이름' }, event('c')];
  await collector.collectCalendar(true, { cause: 'manual', games: ['genshin'] });
  const final = logs.at(-1); assert.ok(final);
  assert.equal(final.collected, 2); assert.equal(final.merged, 2); assert.equal(final.skipped, 2);
  assert.equal(final.added, 1); assert.equal(final.changed, 1); assert.equal(final.removedCandidates, 1);
  assert.equal(final.hadPrevious, true); assert.equal(final.cause, 'manual');
});
test('JSONL 로그는 직렬 저장·재시작 복원·30일·개수 제한과 중단 실행 복구', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'calendar-runs-'));
  try {
    const store = new RunStore(directory, () => start + 3, 2); await store.restore();
    await Promise.all([store.save(run('old', 'ok', start - 31 * 86400000)), store.save(run('one', 'ok', start)), store.save(run('two', 'partial', start + 1)), store.save({ ...run('three', 'running', start + 2), endedAt: null })]);
    assert.deepEqual(store.list().map((item) => item.id), ['three', 'two']);
    const files = await readdir(directory); assert.equal(files.filter((file) => file.endsWith('.jsonl')).length, 1);
    const firstFile = files.find((file) => file.endsWith('.jsonl')); assert.ok(firstFile);
    assert.equal((await readFile(join(directory, firstFile), 'utf8')).trim().split('\n').length, 2);
    const restored = new RunStore(directory, () => start + 4, 2); await restored.restore();
    assert.equal(restored.list().find((item) => item.id === 'three')?.state, 'error');
    assert.equal(restored.list().find((item) => item.id === 'two')?.state, 'partial');
    const scheduler = new CollectionScheduler(async () => {}, fakeClock());
    assert.ok(isRunPage({ runs: restored.list(), total: 2, page: 1, pageSize: 30, scheduler: { ...scheduler.status(), storageError: restored.error } }));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('로그 파일 실패는 별도 상태로 남고 수집 결과를 실패로 덮지 않음', async () => {
  const root = await mkdtemp(join(tmpdir(), 'calendar-log-error-'));
  try {
    const path = join(root, 'not-directory'); await writeFile(path, 'x'); const store = new RunStore(path, () => start);
    await store.restore(); await store.save(run('one')); assert.ok(store.error); assert.equal(store.list()[0]?.state, 'ok');
  } finally { await rm(root, { recursive: true, force: true }); }
});
