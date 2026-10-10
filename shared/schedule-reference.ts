import { EVENT_KINDS, GAME_IDS, isRecord, type CalendarEvent } from './calendar';
import { isWuwaWeeklyKey } from './content-kind';

export interface ScheduleReference {
  game: CalendarEvent['game']; kind: CalendarEvent['kind']; ids: string[]; identities: string[]; startAt: string; endAt: string;
}
export const scheduleIdentifiers = (event: CalendarEvent) => [...new Set([event.id, ...(event.collectionSources ?? []).map((source) => source.id)])];
export const scheduleIdentities = (event: CalendarEvent) => [...new Set([event.identityKey, event.localizationKey].filter((key): key is string => Boolean(key)))];
export const scheduleReference = (event: CalendarEvent): ScheduleReference => ({ game: event.game, kind: event.kind,
  ids: scheduleIdentifiers(event), identities: scheduleIdentities(event), startAt: event.startAt, endAt: event.endAt });
const validKeys = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 110
  && value.every((item) => typeof item === 'string' && item.length > 0 && item.length <= 2000);
export const isScheduleReference = (value: unknown): value is ScheduleReference => isRecord(value)
  && GAME_IDS.some((game) => game === value.game) && EVENT_KINDS.some((kind) => kind === value.kind)
  && validKeys(value.ids) && value.ids.length > 0 && validKeys(value.identities)
  && typeof value.startAt === 'string' && Number.isFinite(Date.parse(value.startAt))
  && typeof value.endAt === 'string' && Date.parse(value.endAt) > Date.parse(value.startAt);

export const matchesScheduleReference = (record: ScheduleReference, event: CalendarEvent) => {
  const migratedWeekly = record.game === 'wuwa' && record.kind === 'challenge' && event.kind === 'weekly'
    && [...record.ids, ...record.identities].some(isWuwaWeeklyKey);
  if (record.game !== event.game || record.kind !== event.kind && !migratedWeekly) return false;
  if (!scheduleIdentifiers(event).some((id) => record.ids.includes(id)) && !scheduleIdentities(event).some((key) => record.identities.includes(key))) return false;
  const a = Date.parse(record.startAt), b = Date.parse(event.startAt), c = Date.parse(record.endAt), d = Date.parse(event.endAt);
  const overlap = Math.min(c, d) - Math.max(a, b);
  return Math.abs(a - b) <= 86400000 && Math.abs(c - d) <= 86400000
    && overlap > 0 && overlap / Math.min(c - a, d - b) >= .8 && overlap / Math.max(c - a, d - b) >= .75;
};

export const resolveScheduleReference = (record: ScheduleReference, events: CalendarEvent[]) => {
  const matches = events.filter((event) => matchesScheduleReference(record, event));
  const direct = matches.filter((event) => scheduleIdentifiers(event).some((id) => record.ids.includes(id)));
  const targets = direct.length ? direct : matches;
  return targets.length === 1 ? targets[0]?.id : undefined;
};
