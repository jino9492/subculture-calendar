import type { CalendarEvent } from '../../../shared/calendar';
import type { CollectionIssue } from '../../../shared/admin';

const DAY = 86400000;
const SEOUL = 9 * 3600000;
const giftName = (title: string) => /^(?:별의선물|giftofodyssey)$/i.test(title.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, ''));

export const applyScheduleTimeRules = (event: CalendarEvent, issues: CollectionIssue[] = []): CalendarEvent => {
  const evidence = event.timeEvidence?.end;
  if (evidence && Date.parse(evidence.at) === Date.parse(event.endAt) && ['manual', 'official'].includes(evidence.basis)
    || event.versionEndBasis === 'manual' || event.versionEndBasis === 'official' || event.versionEndBasis === 'next-maintenance') return event;
  const gift = event.game === 'starrail' && event.kind === 'event'
    && [event.title, ...(event.collectionSources ?? []).map((source) => source.title)].some(giftName);
  const unpublished = event.game !== 'endfield' && (event.periodBasis === 'community-cycle'
    || event.versionEndBasis === 'default-42-days' || event.versionEndBasis === 'announced-date');
  if (!gift && !unpublished) return event;
  // 한국 날짜는 유지하고 콘텐츠 초기화 직전 또는 미공개 종료 기본 시각 적용
  const midnight = Math.floor((Date.parse(event.endAt) + SEOUL) / DAY) * DAY - SEOUL;
  const endAt = new Date(midnight + 5 * 3600000 - (gift ? 1000 : 0)).toISOString();
  if (Date.parse(endAt) <= Date.parse(event.startAt)) {
    issues.push({ id: `timing:${event.id}:rule`, eventId: event.id, game: event.game, title: event.title, sourceUrl: event.sourceUrl,
      reason: '종료 기본 시각을 적용하면 기간이 역전되어 원본 기간을 유지했습니다.', excerpt: `${event.startAt} ~ ${endAt}` });
    return event;
  }
  return { ...event, endAt,
    collectionSources: event.collectionSources ?? [{ id: event.id, title: event.title, startAt: event.startAt, endAt: event.endAt, sourceUrl: event.sourceUrl }],
    timeEvidence: { ...event.timeEvidence, end: { at: endAt, basis: 'schedule-rule', precision: 'second', sourceUrl: event.sourceUrl } } };
};
