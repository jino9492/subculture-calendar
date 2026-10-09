import { EVENT_KINDS, isRecord, type CalendarEvent, type EventKind, type GameId } from '../../../shared/calendar';
import type { CollectionIssue } from '../../../shared/admin';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';

interface NameEntry { title: string; sourceUrl: string; kind?: EventKind; identityKey?: string }
export type KoreanNames = Record<string, NameEntry>;
interface ForeignSchedule extends Omit<CalendarEvent, 'title'> { title: string; localizationKey: string }
const KIND_NAMES = { event: '이벤트', banner: '픽업', challenge: '엔드콘텐츠', version: '버전' };

export const isPendingScheduleName = (event: CalendarEvent) => event.displayLanguage !== 'ko-kr' && !event.sourceLanguage.startsWith('ko')
  && /^(?:이벤트|픽업|엔드콘텐츠|버전) · 한국어 이름 확인$/.test(event.title);

export const attachHoyoNames = (game: GameId, raw: unknown, names: KoreanNames, language: 'ko-kr' | 'en-us') => {
  if (!isRecord(raw)) throw new Error('Invalid calendar data');
  const result: Record<string, unknown> = { ...raw };
  for (const group of ['events', 'banners', 'challenges']) {
    const items = raw[group];
    if (!Array.isArray(items)) throw new Error('Invalid calendar group');
    result[group] = items.map((item, index) => {
      if (!isRecord(item)) return item;
      const fields = ['characters', 'weapons', 'light_cones', 'agents', 'w_engines'];
      const entityIds = fields.flatMap((field) => {
        const entities = item[field];
        return Array.isArray(entities) ? entities.filter(isRecord)
          .filter((entity) => entity.rarity === 5 || entity.rarity === '5' || entity.rarity === 'S')
          .map((entity) => typeof entity.id === 'number' || typeof entity.id === 'string' ? `${field}:${entity.id}` : '') : [];
      }).filter(Boolean).sort();
      const identity = group === 'banners' ? entityIds.join('|') || `${item.id ?? item.banner_type ?? index}:${String(item.name ?? '')}`
        : `${String(item.type_name ?? 'activity')}:${String(item.id ?? createHash('sha256').update(String(item.name ?? '')).digest('hex').slice(0, 24))}`;
      const localizationKey = `hoyo:${game}:${group}:${identity}`;
      if (language === 'ko-kr') return { ...item, localization_key: localizationKey };
      const name = names[localizationKey];
      return { ...item, ...Object.fromEntries(fields.map((field) => [field, []])),
        name: name?.title ?? `${group === 'banners' ? '픽업' : group === 'challenges' ? '엔드콘텐츠' : '이벤트'} · 한국어 이름 확인`,
        description: '', localization_key: localizationKey, localized: Boolean(name), original_name: item.name };
    });
  }
  return result;
};

export const translateScheduleNames = (schedules: ForeignSchedule[], names: KoreanNames) => {
  const events: CalendarEvent[] = [];
  const issues: CollectionIssue[] = [];
  for (const schedule of schedules) {
    const name = names[schedule.localizationKey];
    const title = name?.title ?? `${KIND_NAMES[schedule.kind]} · 한국어 이름 확인`;
    const event = { ...schedule, title, ...(name ? { displayLanguage: 'ko-kr' as const } : {}),
      ...(name?.identityKey ? { identityKey: name.identityKey } : {}) };
    events.push(event);
    if (!name) issues.push({ id: `translation:${schedule.localizationKey}:${schedule.startAt}`, game: schedule.game,
      title, reason: 'ID에 대응하는 한국어 이름 미수집. 원문과 기간을 확인해 일정 제목을 보정하세요.',
      sourceUrl: schedule.sourceUrl, excerpt: `원문 제목: ${schedule.title}\n${schedule.description}`.slice(0, 6000), eventId: schedule.id });
  }
  return { events, issues };
};

export const learnKoreanScheduleNames = (schedules: CalendarEvent[], names: KoreanNames): KoreanNames => {
  const result = { ...names };
  for (const event of schedules) if (event.localizationKey && /^(?:hoyo:|wuwa:wiki:|sra:)/.test(event.localizationKey) && /[가-힣]/.test(event.title)
    && !/한국어 이름 확인/.test(event.title) && (event.displayLanguage === 'ko-kr' || event.sourceLanguage.startsWith('ko')))
    result[event.localizationKey] = { title: event.title, sourceUrl: event.sourceUrl, ...(event.identityKey ? { identityKey: event.identityKey } : {}),
      ...(event.localizationKey.startsWith('sra:') ? { kind: event.kind } : {}) };
  return result;
};

export const restoreKnownScheduleNames = (previous: CalendarEvent[], next: CalendarEvent[]): CalendarEvent[] => next.map((event) => {
  if (!/한국어 이름 확인/.test(event.title)) return event;
  const known = previous.find((candidate) => candidate.game === event.game && candidate.kind === event.kind
    && (candidate.id === event.id || candidate.localizationKey && candidate.localizationKey === event.localizationKey
      && Date.parse(candidate.startAt) === Date.parse(event.startAt))
    && /[가-힣]/.test(candidate.title) && !/한국어 이름 확인/.test(candidate.title)
    && (candidate.displayLanguage === 'ko-kr' || candidate.sourceLanguage.startsWith('ko')));
  return known ? { ...event, title: known.title, displayLanguage: 'ko-kr' } : event;
});

export const loadKoreanNames = async (game: GameId): Promise<KoreanNames> => {
  try {
    const data: unknown = JSON.parse(await readFile(new URL(`../../../.cache/${game}-names.json`, import.meta.url), 'utf8'));
    if (!isRecord(data)) throw new Error('Invalid name dictionary');
    return Object.fromEntries(Object.entries(data).flatMap(([key, item]) => isRecord(item) && typeof item.title === 'string'
      && /[가-힣]/.test(item.title) && typeof item.sourceUrl === 'string' && /^https:\/\//.test(item.sourceUrl)
      ? [[key, { title: item.title, sourceUrl: item.sourceUrl,
        ...(EVENT_KINDS.some((kind) => kind === item.kind) ? { kind: EVENT_KINDS.find((kind) => kind === item.kind) } : {}),
        ...(typeof item.identityKey === 'string' && item.identityKey.length <= 500 ? { identityKey: item.identityKey } : {}) }]] : []));
  } catch (error) {
    if (!isRecord(error) || error.code !== 'ENOENT') console.error(`[${game}] name dictionary unavailable`);
    return {};
  }
};

const writes = new Map<GameId, Promise<void>>();
export const rememberKoreanNames = async (game: GameId, schedules: CalendarEvent[], forgetKey?: string) => {
  const previous = writes.get(game) ?? Promise.resolve();
  const next = previous.catch((error: unknown) => console.error(`[${game}] previous name save failed`, error)).then(async () => {
    const names = learnKoreanScheduleNames(schedules, await loadKoreanNames(game));
    if (forgetKey) delete names[forgetKey];
    await mkdir(new URL('../../../.cache/', import.meta.url), { recursive: true });
    const target = new URL(`../../../.cache/${game}-names.json`, import.meta.url);
    const temporary = new URL(`${target.href}.tmp`);
    await writeFile(temporary, JSON.stringify(names));
    await rename(temporary, target);
  });
  writes.set(game, next);
  try { await next; }
  finally { if (writes.get(game) === next) writes.delete(game); }
};
