import { isRecord } from '../../../shared/calendar';
import type { PlannerOptions } from './types';

export const DEFAULT_OPTIONS: PlannerOptions = { marginHours: 24, includeBanners: false, availability: 'any', hourKst: 20 };
const integer = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
export const restorePlannerPreferences = (saved: unknown) => {
  const value = isRecord(saved) ? saved : {};
  const raw = isRecord(value.options) ? value.options : {};
  const options: PlannerOptions = {
    marginHours: integer(raw.marginHours, 0, 168) ? raw.marginHours : DEFAULT_OPTIONS.marginHours,
    includeBanners: typeof raw.includeBanners === 'boolean' ? raw.includeBanners : false,
    availability: raw.availability === 'daily' || raw.availability === 'weekends' ? raw.availability : 'any',
    hourKst: integer(raw.hourKst, 0, 23) ? raw.hourKst : DEFAULT_OPTIONS.hourKst,
  };
  return { options };
};
