import type { CalendarEvent, TimeEvidence } from '../../../../../shared/calendar';

const DAY = 86400000;
const SEOUL = 9 * 3600000;
export const HONKAI_RESET_HOUR = 4;
export const HONKAI_VERSION_START_HOUR = 17;
export const HONKAI_VERSION_END_HOUR = 11;
export const HONKAI_SUPPLY_HOUR = 12;
const day = (at: string) => Math.floor((Date.parse(at) + SEOUL) / DAY);
const localHour = (at: string, hour: number) => new Date(day(at) * DAY - SEOUL + hour * 3600000).toISOString();
const ruleDate = (evidence: TimeEvidence | undefined, at: string) => {
  if (!evidence || evidence.at !== at || evidence.basis === 'manual') return undefined;
  return evidence.precision === 'date' ? at : evidence.basis === 'schedule-rule' ? evidence.ruleDateAt : undefined;
};

export const applyHonkaiTimeRules = (events: CalendarEvent[]): CalendarEvent[] => {
  const versions = events.filter((event) => event.game === 'honkai' && event.kind === 'version');
  const corrected = events.map((event) => {
    if (event.game !== 'honkai') return event;
    const start = event.timeEvidence?.start, end = event.timeEvidence?.end;
    const startDate = ruleDate(start, event.startAt), endDate = ruleDate(end, event.endAt);
    const originalEnd = end?.basis === 'schedule-rule' && end.at === event.endAt ? end.ruleOriginalAt : undefined;
    if (!startDate && !endDate && !originalEnd) return event;
    const matches = versions.filter((candidate) => candidate.id === event.versionStartId);
    const version = matches.length === 1 ? matches[0] : undefined;
    const versionDate = version && ruleDate(version.timeEvidence?.start, version.startAt);
    // 원래 날짜와 명시적 버전 연결을 보존하여 뒤늦은 점검 공지에도 재계산
    const linkedStart = version && startDate && day(version.startAt) === day(startDate)
      ? versionDate ? localHour(versionDate, HONKAI_VERSION_START_HOUR) : version.startAt : undefined;
    const startAt = startDate ? linkedStart ?? localHour(startDate, event.kind === 'version' ? HONKAI_VERSION_START_HOUR
      : event.kind === 'banner' ? HONKAI_SUPPLY_HOUR : HONKAI_RESET_HOUR) : event.startAt;
    const endAt = endDate ? localHour(endDate, event.kind === 'version' ? HONKAI_VERSION_END_HOUR
      : event.kind === 'banner' ? HONKAI_SUPPLY_HOUR : HONKAI_RESET_HOUR) : originalEnd ?? event.endAt;
    if (Date.parse(endAt) <= Date.parse(startAt)) return event;
    const evidence = (at: string, dateAt: string | undefined, previous: TimeEvidence | undefined): TimeEvidence | undefined =>
      dateAt ? { at, basis: 'schedule-rule', precision: 'second', sourceUrl: previous?.sourceUrl ?? event.sourceUrl, ruleDateAt: dateAt } : previous;
    return { ...event, startAt, endAt,
      timeEvidence: { ...event.timeEvidence, start: evidence(startAt, startDate, start),
        end: originalEnd ? { ...end!, at: endAt } : evidence(endAt, endDate, end) } };
  });
  const correctedVersions = corrected.filter((event) => event.game === 'honkai' && event.kind === 'version');
  return corrected.map((event) => {
    if (event.game !== 'honkai' || event.kind !== 'banner' || event.timeEvidence?.end?.basis === 'manual') return event;
    const owning = correctedVersions.filter((version) => Date.parse(version.startAt) <= Date.parse(event.startAt)
      && Date.parse(event.startAt) < Date.parse(version.endAt));
    if (owning.length !== 1) return event;
    const version = owning[0]!;
    if (Date.parse(event.endAt) <= Date.parse(version.endAt)) return event;
    const end = event.timeEvidence?.end;
    // 버전 마지막 보급의 종료를 점검 시작 경계에 제한하고 원래 종료 근거 보존
    return { ...event, endAt: version.endAt, timeEvidence: { ...event.timeEvidence, end: {
      at: version.endAt, basis: 'schedule-rule' as const, precision: 'second' as const,
      sourceUrl: version.timeEvidence?.end?.sourceUrl ?? version.sourceUrl,
      ...(end?.ruleDateAt ? { ruleDateAt: end.ruleDateAt } : { ruleOriginalAt: end?.ruleOriginalAt ?? event.endAt }),
    } } };
  });
};
