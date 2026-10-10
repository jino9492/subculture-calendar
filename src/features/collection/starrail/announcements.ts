import { applyStarrailChallengeStarts } from './custom/challenge-starts';
import type { CalendarEvent } from '../../../../shared/calendar';
import type { Announcement } from '../hoyo/announcements';
import type { VersionBoundary } from '../parsers';
import { reconcileSchedules, isSameScheduleCycle } from '../reconciliation';
import { parseHoyoTimeRange } from '../time-evidence';

export const supplementStarrailChallenges = (events: CalendarEvent[], parsedEvents: CalendarEvent[], announcements: Announcement[], boundaries: VersionBoundary[]) => {
  const challengeTargets = reconcileSchedules(parsedEvents).events;
  for (const article of announcements) {
    const lines = article.description.split('\n').map((line) => line.trim()).filter(Boolean);
    const normalize = (value: string) => value.replace(/[^\p{L}\p{N}]/gu, '');
    for (const [index, line] of lines.entries()) {
      if (!['혼돈의 기억', '허구 이야기', '종말의 환영'].some((name) => line.startsWith(name)) || line.length > 80) continue;
      const section = lines[index + 1] ?? '';
      const evidence = parseHoyoTimeRange(section, boundaries, article.url);
      if (!evidence) continue;
      const native = challengeTargets.filter((event) => event.kind === 'challenge' && normalize(event.title) === normalize(line)
        && isSameScheduleCycle(event, { ...event, startAt: evidence.start.at, endAt: evidence.end.at, sourceUrl: article.url }, true));
      const event = native.length === 1 ? native[0] : undefined;
      if (!event) continue;
      const identityKey = event.identityKey ?? event.localizationKey ?? `notice-target:starrail:${event.id}`;
      for (const candidate of events) if (candidate.id === event.id) candidate.identityKey = identityKey;
      events.push({ ...event, id: `starrail:announcement:${article.id}:challenge:${index}:${evidence.start.at}`,
        startAt: evidence.start.at, endAt: evidence.end.at, collectionSources: undefined,
        collectionMethod: 'announcement', identityKey,
        localizationKey: undefined, sourceUrl: article.url, timeEvidence: evidence,
        description: `공식 한국어 인게임 공지의 기간. ${line}\n${section}` });
    }
    applyStarrailChallengeStarts(events, article, boundaries);
  }
};
