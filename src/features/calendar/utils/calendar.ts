import type { CalendarEvent } from '../types';

export const DAY_MS = 86400000;
export const preserveTimelineScroll = (left: number, previousFirst: number, first: number, dayWidth: number, maximum: number) =>
  Math.max(0, Math.min(maximum, left + (previousFirst - first) * dayWidth));
const SEOUL_OFFSET = 9 * 3600000;
export const timelineTimePosition = (now: number, first: number, last: number) => {
  const seoulTime = now + SEOUL_OFFSET;
  const day = Math.floor(seoulTime / DAY_MS);
  if (day < first || day > last) return null;
  const hour = Math.floor((seoulTime - day * DAY_MS) / 3600000);
  return { day, hour, position: day - first + hour / 24 };
};
export const dayNumber = (iso: string) => Math.floor((Date.parse(iso) + SEOUL_OFFSET) / DAY_MS);
export const dayDate = (day: number) => new Date(day * DAY_MS);
export const todayDay = () => dayNumber(new Date().toISOString());
export const formatTime = (iso: string) => new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date(iso));
export const formatEventEnd = (event: CalendarEvent) => event.versionEndBasis === 'announced-date'
  ? `${new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' }).format(new Date(event.endAt))} · 시각 확인 필요`
  : formatTime(event.endAt);

export const monthRange = (year: number, month: number) => {
  const first = Date.UTC(year, month, 1) / DAY_MS;
  const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return { first, last: first + count - 1, days: Array.from({ length: count }, (_, index) => first + index) };
};

export const calendarRange = (events: CalendarEvent[], now = Date.now()) => {
  const upcoming = events.filter((event) => Date.parse(event.endAt) > now);
  if (!upcoming.length) return null;
  const first = Math.min(...upcoming.map((event) => dayNumber(event.startAt)));
  const last = Math.max(...events.map((event) => dayNumber(event.endAt)));
  return { first, last, days: Array.from({ length: last - first + 1 }, (_, index) => first + index) };
};

export const endingCountdown = (endAt: string, now: number) => {
  const remaining = Date.parse(endAt) - now;
  const tone = remaining <= 0 ? 'expired' : remaining <= 3 * DAY_MS ? 'urgent' : remaining < 7 * DAY_MS ? 'soon' : 'normal';
  if (remaining <= 0) return { tone, label: '종료' };
  if (remaining <= DAY_MS) {
    const minutes = Math.ceil(remaining / 60000);
    return { tone, label: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')} 남음` };
  }
  return { tone, label: `${Math.floor(remaining / DAY_MS)}일 남음` };
};

export const nearestEnding = (events: CalendarEvent[], now: number) => {
  const upcoming = events.filter((event) => Date.parse(event.endAt) > now);
  return (upcoming.length ? upcoming : events).reduce<CalendarEvent | undefined>((nearest, event) =>
    !nearest || Date.parse(event.endAt) < Date.parse(nearest.endAt) ? event : nearest, undefined);
};

export interface EventSegment { event: CalendarEvent; start: number; end: number; continuesBefore: boolean; continuesAfter: boolean }
export const eventEndDay = (event: CalendarEvent) => dayNumber(new Date(Date.parse(event.endAt) - 1).toISOString());
export const intersectsDay = (event: CalendarEvent, day: number) => dayNumber(event.startAt) <= day && eventEndDay(event) >= day;

export const groupEndingEvents = (events: CalendarEvent[], firstDay: number, lastDay: number) => {
  const groups = new Map<number, CalendarEvent[]>();
  for (const event of events) {
    if (event.kind === 'version' && Date.parse(event.endAt) - Date.parse(event.startAt) <= 1000) continue;
    // 기간 막대의 마지막 점유일과 달리 실제 종료 시각의 한국 날짜로 분류
    const day = dayNumber(event.endAt);
    if (day < firstDay || day > lastDay) continue;
    const group = groups.get(day);
    if (group) group.push(event); else groups.set(day, [event]);
  }
  for (const group of groups.values()) group.sort((a, b) => Date.parse(a.endAt) - Date.parse(b.endAt) || a.id.localeCompare(b.id));
  return groups;
};

export const packRange = (events: CalendarEvent[], firstDay: number, lastDay: number): EventSegment[][] => {
  const versionEnds = new Map<string, number>();
  const versions = events.filter((event) => event.kind === 'version')
    .sort((a, b) => a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id));
  for (const [index, version] of versions.entries()) {
    const next = versions.slice(index + 1).find((candidate) => candidate.game === version.game);
    // 버전 전환일은 새 버전에 배정하고 실제 종료 시각은 원본에 유지
    versionEnds.set(version.id, Math.min(eventEndDay(version), next ? dayNumber(next.startAt) - 1 : Infinity));
  }
  const segments = events.map((event) => ({ event, displayEnd: versionEnds.get(event.id) ?? eventEndDay(event) }))
    .filter(({ event, displayEnd }) => dayNumber(event.startAt) <= lastDay && displayEnd >= firstDay && displayEnd >= dayNumber(event.startAt))
    .map(({ event, displayEnd }) => ({ event, start: Math.max(0, dayNumber(event.startAt) - firstDay), end: Math.min(lastDay - firstDay, displayEnd - firstDay),
      continuesBefore: dayNumber(event.startAt) < firstDay, continuesAfter: displayEnd > lastDay }))
    .sort((a, b) => a.start - b.start || b.end - a.end || a.event.id.localeCompare(b.event.id));
  const lanes: EventSegment[][] = [];
  for (const segment of segments) {
    const lane = lanes.find((existing) => existing.every((placed) => placed.end < segment.start || placed.start > segment.end));
    if (lane) lane.push(segment); else lanes.push([segment]);
  }
  return lanes;
};

export const packTimeRange = (events: CalendarEvent[], firstDay: number, lastDay: number): EventSegment[][] => {
  const firstTime = firstDay * DAY_MS - SEOUL_OFFSET;
  const lastTime = (lastDay + 1) * DAY_MS - SEOUL_OFFSET;
  const versions = events.filter((event) => event.kind === 'version')
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt) || a.id.localeCompare(b.id));
  const versionEnds = new Map<string, number>();
  for (const [index, version] of versions.entries()) {
    const next = versions.slice(index + 1).find((candidate) => candidate.game === version.game);
    versionEnds.set(version.id, Math.min(Date.parse(version.endAt), next ? Date.parse(next.startAt) : Infinity));
  }
  const segments = events.map((event) => {
    const startAt = Date.parse(event.startAt);
    const endAt = versionEnds.get(event.id) ?? Date.parse(event.endAt);
    return { event, startAt, endAt };
  }).filter(({ startAt, endAt }) => startAt < lastTime && endAt > firstTime && endAt > startAt)
    .map(({ event, startAt, endAt }) => ({ event,
      start: (Math.max(firstTime, startAt) - firstTime) / DAY_MS,
      end: (Math.min(lastTime, endAt) - firstTime) / DAY_MS,
      continuesBefore: startAt < firstTime, continuesAfter: endAt > lastTime,
    })).sort((a, b) => a.start - b.start || b.end - a.end || a.event.id.localeCompare(b.event.id));
  const lanes: EventSegment[][] = [];
  for (const segment of segments) {
    const lane = lanes.find((existing) => existing.every((placed) => placed.end <= segment.start || placed.start >= segment.end));
    if (lane) lane.push(segment); else lanes.push([segment]);
  }
  return lanes;
};

export const timeEvidenceLabel = (basis: NonNullable<CalendarEvent['timeEvidence']>['start']) => {
  if (!basis) return '수집 시각';
  return { manual: '수동 확인', official: '공식 공지', 'schedule-rule': '일정 종료 규칙', 'version-update': '예정 점검 종료 후',
    'version-cycle': '버전별 갱신 · 예정 점검 종료 후', 'community-data': '공개 일정 · 시각 확인 필요' }[basis.basis];
};
