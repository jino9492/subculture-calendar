import { isCalendarEvent, isCollectedCalendar, isRecord, GAME_IDS, type CalendarEvent, type CollectedCalendar, type GameId } from './calendar';

export interface CollectionIssue {
  id: string;
  game: GameId;
  title: string;
  reason: string;
  sourceUrl: string;
  excerpt: string;
  eventId?: string;
}
export interface Review {
  status: 'resolved' | 'ignored';
  note: string;
  updatedAt: string;
}
export interface EventOverride { event: CalendarEvent; hidden: boolean }
export interface AdminState {
  reviews: Record<string, Review>;
  overrides: Record<string, EventOverride>;
}
export interface AdminResponse extends CollectedCalendar {
  issues: CollectionIssue[];
  collectedEvents: CalendarEvent[];
  management: AdminState;
}
export type AdminAction =
  | { action: 'review'; id: string; status: 'pending' | 'resolved' | 'ignored'; note: string }
  | { action: 'save'; event: CalendarEvent; hidden: boolean; issueId?: string; note: string }
  | { action: 'reset'; id: string };

const validText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;
const validSourceUrl = (value: string): boolean => {
  try { return new URL(value).protocol === 'https:'; }
  catch { return false; }
};
export const isCollectionIssue = (value: unknown): value is CollectionIssue => isRecord(value)
  && validText(value.id, 1000) && GAME_IDS.some((game) => game === value.game)
  && validText(value.title, 1000) && validText(value.reason, 3000) && validText(value.excerpt, 6000)
  && typeof value.sourceUrl === 'string' && /^https:\/\//.test(value.sourceUrl)
  && (value.eventId === undefined || validText(value.eventId, 1000));
const isReview = (value: unknown): value is Review => isRecord(value)
  && (value.status === 'resolved' || value.status === 'ignored') && validText(value.note, 3000)
  && typeof value.updatedAt === 'string' && Number.isFinite(Date.parse(value.updatedAt));
export const isAdminState = (value: unknown): value is AdminState => isRecord(value)
  && isRecord(value.reviews) && Object.values(value.reviews).every(isReview)
  && isRecord(value.overrides) && Object.entries(value.overrides).every(([id, item]) =>
    isRecord(item) && isCalendarEvent(item.event) && item.event.id === id && typeof item.hidden === 'boolean');
export const isAdminResponse = (value: unknown): value is AdminResponse => isCollectedCalendar(value)
  && isRecord(value) && Array.isArray(value.issues) && value.issues.every(isCollectionIssue)
  && Array.isArray(value.collectedEvents) && value.collectedEvents.every(isCalendarEvent) && isAdminState(value.management);
export const isAdminAction = (value: unknown): value is AdminAction => {
  if (!isRecord(value)) return false;
  if (value.action === 'review') return validText(value.id, 1000) && value.id.length > 0
    && (value.status === 'pending' || value.status === 'resolved' || value.status === 'ignored') && validText(value.note, 3000);
  if (value.action === 'reset') return validText(value.id, 1000) && value.id.length > 0;
  return value.action === 'save' && isCalendarEvent(value.event) && validText(value.event.id, 1000)
    && value.event.id.length > 0 && validText(value.event.title, 500) && value.event.title.trim().length > 0
    && validText(value.event.description, 6000) && validText(value.event.sourceUrl, 2000) && validSourceUrl(value.event.sourceUrl)
    && validText(value.event.sourceLanguage, 40) && typeof value.hidden === 'boolean' && validText(value.note, 3000)
    && (value.issueId === undefined || validText(value.issueId, 1000));
};
