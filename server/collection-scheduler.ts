import { GAME_IDS, type GameId } from '../shared/calendar';
import type { CollectionRun } from '../shared/collection-runs';

interface Clock { now: () => number; set: (fn: () => void, delay: number) => unknown; clear: (timer: unknown) => void }
interface GameTiming { next: number; failures: number; lastSuccessAt: string | null; lastFailureAt: string | null }
export class CollectionScheduler {
  private stopped = true;
  private timer: unknown;
  private busy = false;
  private timing = new Map<GameId, GameTiming>(GAME_IDS.map((game) => [game, { next: 0, failures: 0, lastSuccessAt: null, lastFailureAt: null }]));
  constructor(private collect: (games: GameId[], scheduledAt: string) => Promise<unknown>, private clock: Clock, readonly intervalMs = 900000) {}
  update(run: CollectionRun) {
    const state = this.timing.get(run.game);
    if (!state || run.state === 'running') return;
    const failure = run.state === 'error' || run.state === 'stale';
    if (failure) { state.failures++; state.lastFailureAt = run.endedAt; }
    else { state.failures = 0; state.lastSuccessAt = run.endedAt; }
    state.next = this.clock.now() + Math.min(this.intervalMs * 2 ** Math.min(state.failures, 4), 4 * 3600000);
    if (!this.busy && !this.stopped) this.schedule();
  }
  start() { if (!this.stopped) return; this.stopped = false; for (const state of this.timing.values()) if (!state.next) state.next = this.clock.now() + this.intervalMs; this.schedule(); }
  stop() { this.stopped = true; if (this.timer !== undefined) this.clock.clear(this.timer); this.timer = undefined; }
  status() {
    const next = this.stopped ? null : Math.min(...[...this.timing.values()].map((state) => state.next));
    return { enabled: !this.stopped, running: this.busy, intervalMs: this.intervalMs, nextRunAt: this.busy || next === null ? null : new Date(next).toISOString(),
      games: [...this.timing].map(([game, state]) => ({ game, nextRunAt: this.stopped ? null : new Date(state.next).toISOString(), failures: state.failures,
        lastSuccessAt: state.lastSuccessAt, lastFailureAt: state.lastFailureAt })) };
  }
  private schedule() {
    if (this.stopped || this.busy) return;
    if (this.timer !== undefined) this.clock.clear(this.timer);
    const due = Math.min(...[...this.timing.values()].map((state) => state.next));
    this.timer = this.clock.set(() => { void this.execute(due); }, Math.max(0, due - this.clock.now()));
  }
  private async execute(due: number) {
    this.timer = undefined;
    if (this.stopped || this.busy) return;
    this.busy = true;
    const games = [...this.timing].filter(([, state]) => state.next <= this.clock.now()).map(([game]) => game);
    try { await this.collect(games, new Date(due).toISOString()); }
    catch (error) { console.error('자동 수집 실행 실패', error); }
    finally {
      // 절전 중 누락 횟수를 반복 실행하지 않고 완료 후 한 번만 다음 시점 예약
      for (const game of games) { const state = this.timing.get(game); if (state && state.next <= this.clock.now()) state.next = this.clock.now() + this.intervalMs; }
      this.busy = false; this.schedule();
    }
  }
}
