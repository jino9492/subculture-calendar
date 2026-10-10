import type { CalendarEvent, GameId } from '../../../shared/calendar';
import { applyGenshinChallengeImages } from './genshin/custom/challenge-images';
import { applyEndfieldChallengeImages } from './endfield/custom/challenge-images';
import { buildStarrailWeeklySchedules } from './starrail/custom/weekly';
import { applyStarrailChallengeImages } from './starrail/custom/challenge-images';
import { buildZenlessWeeklySchedules } from './zenless/custom/weekly';
import { applyZenlessChallengeImages } from './zenless/custom/challenge-images';
import { mergeWuwaWeeklySchedules } from './wuwa/custom/weekly';

export const refreshCustomSchedules = (game: GameId, events: CalendarEvent[], now: number): CalendarEvent[] => {
  if (game === 'wuwa') return mergeWuwaWeeklySchedules(events);
  if (game === 'genshin') events = applyGenshinChallengeImages(events);
  if (game === 'endfield') events = applyEndfieldChallengeImages(events);
  if (game === 'starrail') events = applyStarrailChallengeImages(events);
  if (game === 'zenless') events = applyZenlessChallengeImages(events);
  const weekly = game === 'starrail' ? buildStarrailWeeklySchedules(now)
    : game === 'zenless' ? buildZenlessWeeklySchedules(now) : [];
  if (!weekly.length) return events;
  return [...events.filter((event) => !event.id.startsWith(`${game}:custom:weekly:`)), ...weekly];
};
