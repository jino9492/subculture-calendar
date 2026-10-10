import { CUSTOM_SCHEDULE_IMAGES } from './schedule-images';

export const GAME_IDS = ['genshin', 'starrail', 'zenless', 'wuwa', 'endfield'] as const;
export type GameId = (typeof GAME_IDS)[number];
export const EVENT_KINDS = ['version', 'event', 'banner', 'challenge', 'weekly'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export interface TimeEvidence {
  at: string;
  basis: 'manual' | 'official' | 'schedule-rule' | 'version-update' | 'version-cycle' | 'community-data';
  precision: 'second' | 'minute' | 'date';
  sourceUrl: string;
}

export interface CalendarEvent {
  id: string;
  game: GameId;
  kind: EventKind;
  title: string;
  startAt: string;
  endAt: string;
  sourceUrl: string;
  description: string;
  imageUrls?: string[];
  sourceLanguage: string;
  displayLanguage?: 'ko-kr';
  localizationKey?: string;
  identityKey?: string;
  collectionMethod?: 'structured' | 'announcement';
  collectionSources?: { id: string; title: string; startAt: string; endAt: string; sourceUrl: string }[];
  periodBasis?: 'community-data' | 'community-cycle';
  versionEndBasis?: 'official' | 'next-maintenance' | 'announced-date' | 'default-42-days' | 'manual';
  versionEndSourceUrl?: string;
  timeEvidence?: { start?: TimeEvidence; end?: TimeEvidence };
}

export interface SourceStatus {
  game: GameId;
  state: 'ok' | 'partial' | 'stale' | 'error';
  fetchedAt: string | null;
  message: string;
  skipped: number;
}

export interface CalendarData {
  events: CalendarEvent[];
  server: 'Asia';
  displayTimeZone: 'Asia/Seoul';
}

export interface CalendarResponse extends CalendarData {
  status: 'ok' | 'stale' | 'unavailable';
  updatedAt: string | null;
}

export interface CollectedCalendar extends CalendarData {
  sources: SourceStatus[];
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isImageUrl = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length > 2048) return false;
  if (Object.values(CUSTOM_SCHEDULE_IMAGES).some((path) => path === value)) return true;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }
  catch { return false; }
};

export const isCalendarEvent = (value: unknown): value is CalendarEvent => {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string' && GAME_IDS.some((game) => game === value.game)
    && EVENT_KINDS.some((kind) => kind === value.kind) && typeof value.title === 'string'
    && typeof value.startAt === 'string' && typeof value.endAt === 'string'
    && Number.isFinite(Date.parse(value.startAt)) && Number.isFinite(Date.parse(value.endAt))
    && Date.parse(value.endAt) > Date.parse(value.startAt) && typeof value.sourceUrl === 'string'
    && /^https:\/\//.test(value.sourceUrl) && typeof value.description === 'string'
    && typeof value.sourceLanguage === 'string'
    && (value.imageUrls === undefined || Array.isArray(value.imageUrls) && value.imageUrls.length <= 12 && value.imageUrls.every(isImageUrl))
    && (value.displayLanguage === undefined || value.displayLanguage === 'ko-kr')
    && (value.localizationKey === undefined || typeof value.localizationKey === 'string' && value.localizationKey.length <= 500)
    && (value.identityKey === undefined || typeof value.identityKey === 'string' && value.identityKey.length <= 500)
    && (value.collectionMethod === undefined || value.collectionMethod === 'structured' || value.collectionMethod === 'announcement')
    && (value.collectionSources === undefined || Array.isArray(value.collectionSources) && value.collectionSources.length <= 100
      && value.collectionSources.every((source) => isRecord(source) && typeof source.id === 'string' && source.id.length <= 1000
        && typeof source.title === 'string' && typeof source.startAt === 'string' && Number.isFinite(Date.parse(source.startAt))
        && typeof source.endAt === 'string' && Date.parse(source.endAt) > Date.parse(source.startAt)
        && typeof source.sourceUrl === 'string' && /^https:\/\//.test(source.sourceUrl)))
    && (value.periodBasis === undefined || value.periodBasis === 'community-data' || value.periodBasis === 'community-cycle')
    && (value.versionEndBasis === undefined || ['official', 'next-maintenance', 'announced-date', 'default-42-days', 'manual'].some((basis) => basis === value.versionEndBasis))
    && (value.versionEndSourceUrl === undefined || typeof value.versionEndSourceUrl === 'string' && /^https:\/\//.test(value.versionEndSourceUrl))
    && (value.timeEvidence === undefined || isRecord(value.timeEvidence)
      && ['start', 'end'].every((field) => {
        const evidence = isRecord(value.timeEvidence) ? value.timeEvidence[field] : undefined;
        return evidence === undefined || isRecord(evidence) && typeof evidence.at === 'string' && Number.isFinite(Date.parse(evidence.at))
          && ['manual', 'official', 'schedule-rule', 'version-update', 'version-cycle', 'community-data'].includes(String(evidence.basis))
          && ['second', 'minute', 'date'].includes(String(evidence.precision))
          && typeof evidence.sourceUrl === 'string' && /^https:\/\//.test(evidence.sourceUrl);
      }));
};

export const isSourceStatus = (value: unknown): value is SourceStatus =>
  isRecord(value) && GAME_IDS.some((game) => game === value.game)
  && ['ok', 'partial', 'stale', 'error'].some((state) => state === value.state)
  && (value.fetchedAt === null || typeof value.fetchedAt === 'string')
  && typeof value.message === 'string' && typeof value.skipped === 'number';

const isCalendarData = (value: unknown): value is CalendarData =>
  isRecord(value) && Array.isArray(value.events) && value.events.every(isCalendarEvent)
  && value.server === 'Asia' && value.displayTimeZone === 'Asia/Seoul';

export const isCalendarResponse = (value: unknown): value is CalendarResponse =>
  isCalendarData(value) && isRecord(value)
  && ['ok', 'stale', 'unavailable'].some((status) => status === value.status)
  && (value.updatedAt === null || typeof value.updatedAt === 'string' && Number.isFinite(Date.parse(value.updatedAt)));

export const isCollectedCalendar = (value: unknown): value is CollectedCalendar =>
  isCalendarData(value) && isRecord(value) && Array.isArray(value.sources) && value.sources.every(isSourceStatus);
