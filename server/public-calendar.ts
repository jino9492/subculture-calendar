import type { CalendarEvent, CalendarResponse, CollectedCalendar } from '../shared/calendar';

export const toPublicCalendar = (calendar: CollectedCalendar, events: CalendarEvent[]): CalendarResponse => {
  const hasFailure = calendar.sources.some((source) => source.state === 'stale' || source.state === 'error');
  const hasData = events.length > 0 || calendar.sources.some((source) => source.state !== 'error');
  const dates = calendar.sources.flatMap((source) => source.fetchedAt && Number.isFinite(Date.parse(source.fetchedAt))
    ? [Date.parse(source.fetchedAt)] : []);
  return {
    events,
    server: calendar.server,
    displayTimeZone: calendar.displayTimeZone,
    status: hasFailure ? hasData ? 'stale' : 'unavailable' : 'ok',
    updatedAt: dates.length ? new Date(Math.min(...dates)).toISOString() : null,
  };
};
