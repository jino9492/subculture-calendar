import { mkdir, readFile, readdir, rename, unlink, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isCollectionRun, type CollectionRun } from '../shared/collection-runs';

const RETENTION = 30 * 86400000;
const MAX_BYTES = 8 * 1024 * 1024;
export class RunStore {
  private records = new Map<string, CollectionRun>();
  private queue = Promise.resolve();
  error: string | null = null;
  constructor(private directory: string, private now = Date.now, private limit = 10000) {}
  private fail(error: unknown) { console.error('수집 로그 저장소 처리 실패', error); this.error = '수집 로그 저장·복원 실패. 일정 수집은 계속됩니다.'; }
  private prune() {
    const rows = [...this.records.values()].filter((run) => Date.parse(run.startedAt) >= this.now() - RETENTION)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id)).slice(0, this.limit);
    let bytes = 0;
    this.records.clear();
    for (const row of rows) { bytes += Buffer.byteLength(JSON.stringify(row)) + 1; if (bytes > MAX_BYTES) break; this.records.set(row.id, row); }
  }
  async restore() {
    try {
      await mkdir(this.directory, { recursive: true });
      const files = (await readdir(this.directory)).filter((file) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(file)).sort().reverse();
      for (const file of files) {
        if (Date.parse(file.slice(0, 10)) + 86400000 < this.now() - RETENTION) continue;
        const path = join(this.directory, file);
        if ((await stat(path)).size > MAX_BYTES) throw new Error('Log file exceeds limit');
        for (const line of (await readFile(path, 'utf8')).split('\n').filter(Boolean)) {
          const raw: unknown = JSON.parse(line);
          if (!isCollectionRun(raw)) throw new Error('Invalid log entry');
          if (!this.records.has(raw.id)) this.records.set(raw.id, raw);
        }
        this.prune();
      }
      // 서버 중단으로 끝나지 않은 실행은 성공으로 취급하지 않고 중단 기록으로 복구
      for (const run of this.records.values()) if (run.state === 'running') this.records.set(run.id, { ...run, state: 'error',
        endedAt: new Date(this.now()).toISOString(), durationMs: Math.max(0, this.now() - Date.parse(run.startedAt)), summary: '이전 서버 실행 중 중단 · 다음 실행에서 다시 확인' });
      await this.flush();
    } catch (error) { this.fail(error); }
  }
  list() { this.prune(); return [...this.records.values()]; }
  save(run: CollectionRun) {
    this.records.set(run.id, run); this.prune();
    this.queue = this.queue.then(async () => { try { await this.flush(); this.error = null; } catch (error) { this.fail(error); } });
    return this.queue;
  }
  drained() { return this.queue; }
  private async flush() {
    await mkdir(this.directory, { recursive: true });
    const days = new Map<string, string[]>();
    for (const run of this.records.values()) { const day = run.startedAt.slice(0, 10); const lines = days.get(day) ?? []; lines.push(JSON.stringify(run)); days.set(day, lines); }
    for (const [day, lines] of days) {
      const target = join(this.directory, `${day}.jsonl`);
      await writeFile(`${target}.tmp`, lines.join('\n') + '\n', 'utf8'); await rename(`${target}.tmp`, target);
    }
    for (const file of await readdir(this.directory)) if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(file) && !days.has(file.slice(0, 10))) await unlink(join(this.directory, file));
  }
}
