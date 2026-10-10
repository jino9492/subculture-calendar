import type { CalendarEvent } from '../../../../../shared/calendar';
import type { Announcement } from '../../hoyo/announcements';
import type { VersionBoundary } from '../../parsers';

export const applyStarrailChallengeStarts = (events: CalendarEvent[], article: Announcement, boundaries: VersionBoundary[]) => {
  const normalize = (value: string) => value.replace(/[^\p{L}\p{N}]/gu, '');
  if (/「이상 중재」[^\n]*버전에 따라 업데이트/.test(article.description)) {
    const theme = /이번 회차 테마:\s*「([^」]+)」/.exec(article.description)?.[1];
    const version = /(\d+\.\d+)\s*버전/.exec(article.title)?.[1];
    const boundary = boundaries.find((candidate) => candidate.version === version);
    if (theme && boundary) for (const event of events) {
      if (event.kind !== 'challenge' || normalize(event.title) !== normalize(theme)
        || Math.abs(Date.parse(event.startAt) - Date.parse(boundary.startAt)) > 86400000
        || Date.parse(boundary.startAt) >= Date.parse(event.endAt)) continue;
      const startEvidence = event.timeEvidence?.start;
      if (startEvidence && Date.parse(startEvidence.at) === Date.parse(event.startAt)
        && ['manual', 'official', 'version-update'].includes(startEvidence.basis)) continue;
      event.collectionSources ??= [{ id: event.id, title: event.title, startAt: event.startAt, endAt: event.endAt, sourceUrl: event.sourceUrl }];
      event.startAt = boundary.startAt;
      event.timeEvidence = { ...event.timeEvidence, start: { at: boundary.startAt,
        basis: 'version-cycle', precision: 'minute', sourceUrl: article.url } };
    }
  }
};
