import { isRecord, type CalendarEvent } from '../../../../shared/calendar';
import type { KoreanNames } from '../names';
import { structuredDate } from '../sra';

export const learnEndfieldChallengeNames = (raw: unknown, events: CalendarEvent[], names: KoreanNames): KoreanNames => {
  const result = { ...names };
  if (!isRecord(raw) || !Array.isArray(raw.activities)) return result;
  for (const item of raw.activities.filter(isRecord)) {
    if (typeof item.name !== 'string' || !/\(Echoes of War\)/.test(item.name)) continue;
    const startAt = structuredDate(item.startTime), endAt = structuredDate(item.endTime);
    if (!startAt || !endAt) continue;
    const matches = events.filter((event) => event.game === 'endfield' && event.kind === 'challenge'
      && event.title.startsWith('전쟁의 메아리 · ') && Math.abs(Date.parse(event.startAt) - Date.parse(startAt)) <= 60000
      && Math.abs(Date.parse(event.endAt) - Date.parse(endAt)) <= 60000);
    const titles = [...new Set(matches.map((event) => event.title))];
    const match = matches[0];
    if (titles.length !== 1 || !match) continue;
    result[`sra:endfield:event:${encodeURIComponent(String(item.id ?? item.name))}`] = {
      title: match.title, sourceUrl: match.sourceUrl, kind: 'challenge',
    };
  }
  return result;
};
