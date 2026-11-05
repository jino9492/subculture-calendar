import type { CalendarEvent } from '../types';
import { DAY_MS, dayNumber, groupEndingEvents } from './calendar';

export const endingNotifications = (events: CalendarEvent[], now: number, isCompleted: (event: CalendarEvent) => boolean) => {
  const deadline = now + 3 * DAY_MS;
  const pending = events.filter((event) => Date.parse(event.endAt) > now
    && Date.parse(event.endAt) <= deadline && !isCompleted(event));
  return [...groupEndingEvents(pending, dayNumber(new Date(now).toISOString()), dayNumber(new Date(deadline).toISOString()))]
    .sort(([a], [b]) => a - b);
};
