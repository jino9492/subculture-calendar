import type { CalendarEvent, TimeEvidence } from '../../../../../shared/calendar';
import { CUSTOM_SCHEDULE_IMAGES } from '../../../../../shared/schedule-images';

const DAY = 86400000;
const WEEK = 7 * DAY;
const SEOUL = 9 * 3600000;
const SOURCE = 'https://subculturegamer.com/honkai-3rd-weekly-contents-routine/';
export const HONKAI_RECURRING_PREFIX = 'honkai:custom:recurring:';
const CONTENTS = [
  { key: 'superstring-first', title: '심연(초끈공간)', kind: 'challenge', startDay: 0, startHour: 15, endDay: 2, endHour: 22,
    image: CUSTOM_SCHEDULE_IMAGES.honkaiSuperstring, description: '월요일 15:00부터 수요일 22:00까지 · 주 2회 중 첫 번째 회차' },
  { key: 'superstring-second', title: '심연(초끈공간)', kind: 'challenge', startDay: 4, startHour: 15, endDay: 6, endHour: 22,
    image: CUSTOM_SCHEDULE_IMAGES.honkaiSuperstring, description: '금요일 15:00부터 일요일 22:00까지 · 주 2회 중 두 번째 회차' },
  { key: 'memorial-arena', title: '기억전장', kind: 'challenge', startDay: 1, startHour: 4, endDay: 7, endHour: 4,
    image: CUSTOM_SCHEDULE_IMAGES.honkaiMemorialArena, description: '화요일 04:00부터 다음 월요일 04:00까지 · 월요일 결산 후 화요일 재개' },
  { key: 'elysian-realm', title: '과거의 낙원', kind: 'weekly', startDay: 0, startHour: 4, endDay: 7, endHour: 4,
    image: CUSTOM_SCHEDULE_IMAGES.honkaiElysianRealm, description: '월요일 04:00부터 다음 월요일 04:00까지 · 주간 보상 갱신' },
] as const;

export const buildHonkaiRecurringSchedules = (now = Date.now()): CalendarEvent[] => {
  if (!Number.isFinite(now)) throw new Error('Invalid Honkai recurring schedule reference time');
  const localDay = Math.floor((now + SEOUL) / DAY) * DAY;
  const monday = localDay - (new Date(localDay).getUTCDay() + 6) % 7 * DAY - SEOUL;
  // 최근 버전의 지난 회차와 다음 회차를 함께 유지하고 KST 요일 기준으로 생성
  return Array.from({ length: 17 }, (_, index) => monday + (index - 8) * WEEK).flatMap((week) => CONTENTS.map((content) => {
    const startAt = new Date(week + content.startDay * DAY + content.startHour * 3600000).toISOString();
    const endAt = new Date(week + content.endDay * DAY + content.endHour * 3600000).toISOString();
    const evidence = (at: string): TimeEvidence => ({ at, basis: 'schedule-rule', precision: 'second', sourceUrl: SOURCE });
    return { id: `${HONKAI_RECURRING_PREFIX}${content.key}:${startAt}`, game: 'honkai', kind: content.kind,
      title: content.title, startAt, endAt, sourceUrl: SOURCE, sourceLanguage: 'ko-kr', displayLanguage: 'ko-kr',
      imageUrls: [content.image], description: `한국 시간 정기 일정: ${content.description}. 보스·날씨 정보는 회차별로 달라질 수 있음.`,
      timeEvidence: { start: evidence(startAt), end: evidence(endAt) } };
  }));
};

export const mergeHonkaiRecurringSchedules = (events: CalendarEvent[], now: number): CalendarEvent[] => [
  ...events.filter((event) => !event.id.startsWith(HONKAI_RECURRING_PREFIX)), ...buildHonkaiRecurringSchedules(now),
];
