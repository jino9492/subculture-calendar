import type { CalendarEvent } from './calendar';

export const isWuwaWeeklyKey = (key: string) => /^wuwa:wiki:challenge:(?:103600001|105500002)(?::|$)/.test(key);

export const normalizeContentKind = (event: CalendarEvent): CalendarEvent => event.game === 'wuwa' && event.kind === 'challenge'
  && (isWuwaWeeklyKey(event.localizationKey ?? event.id) || /수많은 문의 환상|환상의 놀이공원/.test(event.title))
  ? { ...event, kind: 'weekly' } : event;
