import { fileURLToPath } from 'node:url';
import { collectCalendar, observeCollectionRuns } from '../src/features/collection';
import { GAME_IDS } from '../shared/calendar';
import { RUN_CAUSES, RUN_STATES, type CollectionRun } from '../shared/collection-runs';
import { RunStore } from './run-store';
import { CollectionScheduler } from './collection-scheduler';

const store = new RunStore(fileURLToPath(new URL('../.cache/collection-logs/', import.meta.url)));
const timers = new Map<unknown, ReturnType<typeof setTimeout>>();
const scheduler = new CollectionScheduler((games, scheduledAt) => collectCalendar(true, { cause: 'scheduled', games, scheduledAt }), {
  now: Date.now,
  set: (fn, delay) => { const timer = setTimeout(() => { timers.delete(timer); fn(); }, delay); timers.set(timer, timer); return timer; },
  clear: (key) => { const timer = timers.get(key); if (timer) clearTimeout(timer); timers.delete(key); },
});
export const startCollectionRuntime = async () => {
  await store.restore();
  for (const run of store.list().slice().reverse()) scheduler.update(run);
  observeCollectionRuns(async (run) => { scheduler.update(run); await store.save(run); });
  await collectCalendar(false, { cause: 'startup' });
  scheduler.start();
};
export const stopCollectionRuntime = async () => { scheduler.stop(); await store.drained(); };
export const collectionLogPage = (params: URLSearchParams) => {
  const game = GAME_IDS.find((id) => id === params.get('game'));
  const state = RUN_STATES.find((value) => value === params.get('state'));
  const cause = RUN_CAUSES.find((value) => value === params.get('cause'));
  const rows = store.list().filter((run: CollectionRun) => (!game || run.game === game) && (!state || run.state === state) && (!cause || run.cause === cause));
  const pageSize = 30;
  const requestedPage = Number(params.get('page') ?? 1);
  const page = Number.isSafeInteger(requestedPage) ? Math.max(1, Math.min(requestedPage, Math.max(1, Math.ceil(rows.length / pageSize)))) : 1;
  return { runs: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize,
    scheduler: { ...scheduler.status(), storageError: store.error } };
};
