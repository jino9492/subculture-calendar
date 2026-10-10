import type { CalendarEvent, GameId } from '../../../shared/calendar';
import { weeklyStartAt, WEEK_DURATION } from '../../../shared/weekly';

const VISIBLE_WEEKS = 5;

export const buildWeeklySchedules = (content: { game: GameId; key: string; title: string; sourceUrl: string; description: string; imageUrls?: string[] }, now: number): CalendarEvent[] => {
  const monday = weeklyStartAt(now);
  return Array.from({ length: VISIBLE_WEEKS }, (_, index) => {
    const startAt = new Date(monday + index * WEEK_DURATION).toISOString();
    const endAt = new Date(monday + (index + 1) * WEEK_DURATION).toISOString();
    return { id: `${content.game}:custom:weekly:${content.key}:${startAt}`, game: content.game, kind: 'weekly',
      title: content.title, startAt, endAt, sourceUrl: content.sourceUrl, sourceLanguage: 'ko-kr', displayLanguage: 'ko-kr',
      ...(content.imageUrls?.length ? { imageUrls: [...content.imageUrls] } : {}),
      description: `${content.description} · 직접 정의한 주간 일정: 한국 시간 월요일 05:00:00부터 다음 월요일 05:00:00까지`,
      timeEvidence: {
        start: { at: startAt, basis: 'schedule-rule', precision: 'second', sourceUrl: content.sourceUrl },
        end: { at: endAt, basis: 'schedule-rule', precision: 'second', sourceUrl: content.sourceUrl },
      } };
  });
};
