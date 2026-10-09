import type { CalendarResponse } from '../shared/calendar';
import { collectCalendar, isPendingScheduleName } from '../src/features/collection';
import { mergeManagedEvents, readAdminState } from './admin-store';
import { getAdminData } from './admin-service';
import { toPublicCalendar } from './public-calendar';

export const getCalendar = async (): Promise<CalendarResponse> => {
  const { calendar } = await collectCalendar();
  return toPublicCalendar(calendar, mergeManagedEvents(calendar.events, await readAdminState()).filter((event) => !isPendingScheduleName(event)));
};

export const getAdminCalendar = async (force = false) => {
  const { calendar, issues } = await collectCalendar(force, { cause: force ? 'manual' : 'request-expired' });
  return getAdminData(calendar, issues);
};
