import { EVENT_KINDS, GAME_IDS, isRecord, type CalendarEvent } from '../../../shared/calendar';
import { matchesScheduleReference, resolveScheduleReference, scheduleIdentifiers as identifiers, scheduleIdentities as identities } from '../../../shared/schedule-reference';

export interface CompletionRecord {
  key: string;
  game: CalendarEvent['game'];
  kind: CalendarEvent['kind'];
  ids: string[];
  identities: string[];
  startAt: string;
  endAt: string;
  completedAt: string | null;
  updatedAt: string;
}
const RETENTION = 180 * 86400000;
export const canComplete = (event: CalendarEvent) => event.kind !== 'version';
const validDate = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const validKeys = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 110
  && value.every((item) => typeof item === 'string' && item.length > 0 && item.length <= 2000);

export const restoreCompletionRecords = (value: unknown, now = Date.now()): CompletionRecord[] => {
  if (!isRecord(value) || !Array.isArray(value.records)) return [];
  return value.records.slice(0, 10000).filter((item): item is CompletionRecord => isRecord(item)
    && typeof item.key === 'string' && item.key.length <= 3000 && GAME_IDS.some((game) => game === item.game)
    && EVENT_KINDS.some((kind) => kind === item.kind) && item.kind !== 'version'
    && validKeys(item.ids) && item.ids.length > 0 && validKeys(item.identities)
    && validDate(item.startAt) && validDate(item.endAt) && Date.parse(item.endAt) > Date.parse(item.startAt)
    && Date.parse(item.endAt) >= now - RETENTION && validDate(item.updatedAt)
    && (item.completedAt === null || validDate(item.completedAt)));
};

export const mergeCompletionRecords = (left: CompletionRecord[], right: CompletionRecord[], now = Date.now()): CompletionRecord[] => {
  const latest = new Map<string, CompletionRecord>();
  for (const record of [...left, ...right]) {
    if (Date.parse(record.endAt) < now - RETENTION) continue;
    const previous = latest.get(record.key);
    if (!previous) { latest.set(record.key, record); continue; }
    const delta = Date.parse(record.updatedAt) - Date.parse(previous.updatedAt);
    const winner = delta > 0 ? record : delta < 0 ? previous
      : record.completedAt === null && previous.completedAt !== null ? record
        : previous.completedAt === null && record.completedAt !== null ? previous
          : JSON.stringify(record) > JSON.stringify(previous) ? record : previous;
    latest.set(record.key, { ...winner, ids: [...new Set([...previous.ids, ...record.ids])].sort().slice(0, 110),
      identities: [...new Set([...previous.identities, ...record.identities])].sort().slice(0, 110) });
  }
  return [...latest.values()].sort((a, b) => a.key.localeCompare(b.key));
};

const matchesRecord = (record: CompletionRecord, event: CalendarEvent) => {
  return canComplete(event) && matchesScheduleReference(record, event);
};

const recordTarget = (record: CompletionRecord, events: CalendarEvent[]) => {
  return resolveScheduleReference(record, events.filter(canComplete));
};

export const reconcileCompletionRecords = (records: CompletionRecord[], events: CalendarEvent[]) => records.map((record) => {
  const target = recordTarget(record, events);
  const event = target ? events.find((candidate) => candidate.id === target) : undefined;
  if (!event) return record;
  // 완료·취소 시각은 유지하면서 유일하게 확인된 콘텐츠 ID 별칭만 누적
  return { ...record, ids: [...new Set([...record.ids, ...identifiers(event)])].sort().slice(0, 110),
    identities: [...new Set([...record.identities, ...identities(event)])].sort().slice(0, 110) };
});

export const completedEventIds = (records: CompletionRecord[], events: CalendarEvent[]) => {
  const latest = new Map<string, CompletionRecord>();
  for (const record of records) {
    const target = recordTarget(record, events);
    if (!target) continue;
    const previous = latest.get(target);
    if (!previous || Date.parse(record.updatedAt) > Date.parse(previous.updatedAt)
      || record.updatedAt === previous.updatedAt && record.completedAt === null) latest.set(target, record);
  }
  return new Set([...latest.entries()].filter(([, record]) => record.completedAt !== null).map(([id]) => id));
};

export const toggleCompletion = (records: CompletionRecord[], event: CalendarEvent, events: CalendarEvent[], now = Date.now()) => {
  if (!canComplete(event)) return records;
  const linked = records.filter((record) => recordTarget(record, events) === event.id && matchesRecord(record, event));
  const previous = [...linked].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
  const updatedAt = new Date(Math.max(now, ...linked.map((record) => Date.parse(record.updatedAt) + 1))).toISOString();
  const next: CompletionRecord = {
    key: previous?.key ?? JSON.stringify([event.game, event.kind, event.id, Date.parse(event.startAt)]),
    game: event.game, kind: event.kind,
    ids: [...new Set([...identifiers(event), ...linked.flatMap((record) => record.ids)])].slice(0, 110),
    identities: [...new Set([...identities(event), ...linked.flatMap((record) => record.identities)])].slice(0, 110),
    startAt: event.startAt, endAt: event.endAt,
    completedAt: completedEventIds(records, events).has(event.id) ? null : updatedAt, updatedAt,
  };
  return mergeCompletionRecords(records, [next], now);
};

export const allEndingTasksCompleted = (events: CalendarEvent[], isCompleted: (event: CalendarEvent) => boolean, now: number) => {
  const tasks = events.filter(canComplete);
  return tasks.length > 0 && events.every((event) => Date.parse(event.endAt) > now) && tasks.every(isCompleted);
};
