import type { CalendarEvent } from '../../../../../shared/calendar';
import { isWuwaWeeklyKey, WUWA_COMBINED_WEEKLY_KEY } from '../../../../../shared/content-kind';
import { CUSTOM_SCHEDULE_IMAGES } from '../../../../../shared/schedule-images';

export const mergeWuwaWeeklySchedules = (events: CalendarEvent[]): CalendarEvent[] => {
  const groups = new Map<string, CalendarEvent[]>();
  const remaining: CalendarEvent[] = [];
  for (const event of events) {
    const selected = event.game === 'wuwa' && ['weekly', 'challenge'].includes(event.kind)
      && (event.identityKey === WUWA_COMBINED_WEEKLY_KEY || isWuwaWeeklyKey(event.localizationKey ?? event.id)
        || /수많은 문의 환상|환상의 놀이공원/.test(event.title));
    if (!selected) { remaining.push(event); continue; }
    const period = `${Date.parse(event.startAt)}:${Date.parse(event.endAt)}`;
    const group = groups.get(period) ?? [];
    group.push(event);
    groups.set(period, group);
  }
  for (const group of groups.values()) {
    const first = [...group].sort((a, b) => a.id.localeCompare(b.id))[0]!;
    const sources = group.flatMap((event) => [{ id: event.id, title: event.title, startAt: event.startAt,
      endAt: event.endAt, sourceUrl: event.sourceUrl }, ...(event.collectionSources ?? [])]);
    const id = `${WUWA_COMBINED_WEEKLY_KEY}:${new Date(first.startAt).toISOString()}`;
    remaining.push({ ...first, id, kind: 'weekly', title: '수많은 문의 환상 / 환상의 놀이공원',
      identityKey: WUWA_COMBINED_WEEKLY_KEY, localizationKey: WUWA_COMBINED_WEEKLY_KEY,
      sourceLanguage: 'ko-kr', displayLanguage: 'ko-kr', imageUrls: [CUSTOM_SCHEDULE_IMAGES.wuwaWeekly],
      collectionSources: [...new Map(sources.filter((source) => source.id !== id).map((source) => [source.id, source])).values()]
        .sort((a, b) => a.id.localeCompare(b.id)),
      description: '수많은 문의 환상 또는 환상의 놀이공원 중 하나를 선택해 진행하는 주간 임무. 완료 체크를 공유하며, 기간은 API에서 수집한 주차 기준.' });
  }
  return remaining;
};
