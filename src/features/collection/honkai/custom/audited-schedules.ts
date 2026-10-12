import type { CalendarEvent } from '../../../../../shared/calendar';
import type { HonkaiArticle } from '../parsers';

export const supplementHonkaiAuditedSchedules = (events: CalendarEvent[], articles: HonkaiArticle[]) => {
  const version = events.find((event) => event.id === 'honkai:version:9.0');
  const notice = articles.find((article) => /장비 보급\s*\|\s*10월\s*2일.*무결의 사랑.*사법의 시인/.test(article.description));
  if (!version || !notice || events.some((event) => event.kind === 'banner' && /무결의 사랑|진아·인간의 율자/.test(event.title))) return events;
  if (!version.startAt.startsWith('2026-08-20') || !version.endAt.startsWith('2026-10-21')
    || new Date(notice.createdAt * 1000 + 9 * 3600000).getUTCFullYear() !== 2026) return events;
  // 한국 공식 개방일과 지역 서버용 9.0 후반 장비 슬롯 대조
  const startAt = '2026-10-01T15:00:00.000Z';
  const sourceUrl = 'https://marisaimpact.com/calendar90';
  const event: CalendarEvent = { id: 'honkai:custom:9.0:elysia-equipment', game: 'honkai', kind: 'banner',
    title: '무결의 사랑 · 사법의 시인 · 장비 보급', startAt, endAt: version.endAt,
    sourceUrl, sourceLanguage: 'ko-kr', collectionMethod: 'structured', periodBasis: 'community-data',
    description: '한국 공식 주간 공지에서 10월 2일 개방 확인. AruStats 누락 슬롯을 지역 서버용 공개 일정으로 보완. 종료일·시각은 예상 규칙.',
    timeEvidence: { start: { at: startAt, basis: 'official', precision: 'date', sourceUrl: notice.url },
      end: { at: version.endAt, basis: 'community-data', precision: 'date', sourceUrl } } };
  return [...events, event];
};
