import type { CalendarEvent, GameId } from '../../../shared/calendar';
import { buildStarrailWeeklySchedules } from './starrail/custom/weekly';
import { buildZenlessWeeklySchedules } from './zenless/custom/weekly';
import { mergeWuwaWeeklySchedules } from './wuwa/custom/weekly';

export const refreshCustomSchedules = (game: GameId, events: CalendarEvent[], now: number): CalendarEvent[] => {
  if (game === 'wuwa') return mergeWuwaWeeklySchedules(events);
  const weekly = game === 'starrail' ? buildStarrailWeeklySchedules(now)
    : game === 'zenless' ? buildZenlessWeeklySchedules(now) : [];
  if (!weekly.length) return events;
  return [...events.filter((event) => !event.id.startsWith(`${game}:custom:weekly:`)), ...weekly];
};
