import { isRecord, type CalendarEvent } from '../../../../../shared/calendar';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const CONTENTS = [
  { id: 'matrix', title: '종말 매트릭스', field: 'endTime' },
  { id: 'tower', title: '역경의 탑', field: 'seasonEndTime' },
  { id: 'ruins', title: '죽음의 노래와 바닷속 폐허', field: 'seasonEndTime' },
] as const;

export const buildWuwaChallengeCycles = (data: unknown, sourceUrl: string): { events: CalendarEvent[]; missing: string[] } => {
  if (!isRecord(data) || data.server !== 'Asia' || !/^https:\/\//.test(sourceUrl)) throw new Error('Unexpected challenge source');
  const events: CalendarEvent[] = [];
  const missing: string[] = [];
  const timestamp = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    && Number.isFinite(new Date(value * 1000).getTime()) ? new Date(value * 1000).toISOString() : null;
  for (const content of CONTENTS) {
    const raw = data[content.id];
    if (!isRecord(raw)) { missing.push(content.title); continue; }
    const endAt = timestamp(raw[content.field]);
    const startAt = timestamp(raw.previousEndTime);
    if (!startAt || !endAt || endAt <= startAt) { missing.push(content.title); continue; }
    events.push({ id: `wuwa:challenge:${content.id}:${endAt}`, game: 'wuwa', kind: 'challenge', title: content.title,
      startAt, endAt, sourceUrl, sourceLanguage: 'ko-kr', description: '직전 주기 종료부터 현재 주기 종료까지. 연속된 주기 종료 시각 기준.' });
  }
  return { events, missing };
};

export const updateWuwaChallengeEnds = (data: unknown, history: unknown, now: number) => {
  if (!isRecord(data) || data.server !== 'Asia') throw new Error('Unexpected challenge server');
  const current: Record<string, unknown> = { server: 'Asia' };
  const next: Record<string, unknown> = { server: 'Asia' };
  for (const content of CONTENTS) {
    const raw = data[content.id];
    const old = isRecord(history) && history.server === 'Asia' ? history[content.id] : undefined;
    const end = isRecord(raw) ? raw[content.field] : undefined;
    if (!isRecord(raw) || typeof end !== 'number' || !Number.isSafeInteger(end)
      || end <= now / 1000 || !Number.isFinite(new Date(end * 1000).getTime())) {
      if (isRecord(old)) next[content.id] = old;
      continue;
    }
    let previous = raw.previousEndTime;
    if (previous === undefined && isRecord(old)) {
      if (old.end === end) previous = old.previous;
      // 갱신 전후 수집이 30분 이내로 이어진 경우에만 직전 주기로 연결
      else if (typeof old.end === 'number' && old.end < end && old.end * 1000 <= now
        && typeof old.observedAt === 'number' && old.observedAt <= old.end * 1000
        && now - old.observedAt <= 30 * 60000) previous = old.end;
    }
    current[content.id] = { [content.field]: end, ...(previous !== undefined ? { previousEndTime: previous } : {}) };
    next[content.id] = { end, observedAt: now, ...(previous !== undefined ? { previous } : {}) };
  }
  return { current, history: next };
};

export const collectWuwaChallengeCycles = async (data: unknown, sourceUrl: string) => {
  const path = new URL('../../../../../.cache/wuwa-cycle-boundaries.json', import.meta.url);
  let history: unknown;
  try { history = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (!isRecord(error) || error.code !== 'ENOENT') console.error('[wuwa] cycle history unavailable'); }
  const updated = updateWuwaChallengeEnds(data, history, Date.now());
  const result = buildWuwaChallengeCycles(updated.current, sourceUrl);
  await mkdir(new URL('../../../../../.cache/', import.meta.url), { recursive: true });
  await writeFile(path, JSON.stringify(updated.history));
  return result;
};
