import type { CalendarEvent } from '../../../shared/calendar';
import { reconcileSchedules } from './reconciliation';

export const mergeScheduleSources = (primary: CalendarEvent[], fallback: CalendarEvent[]) =>
  reconcileSchedules([...primary, ...fallback]).events;
