import type { CalendarEvent } from '../../../shared/calendar';
export interface PlannerOptions { marginHours: number; includeBanners: boolean; availability: 'any' | 'daily' | 'weekends'; hourKst: number }
export interface PlannedTask { event: CalendarEvent }
export interface Visit { at: number; tasks: PlannedTask[] }
export interface AttentionTask { task: PlannedTask; reason: string }
export interface PlanResult {
  visits: Visit[]; immediate: AttentionTask[]; attention: AttentionTask[]; remaining: PlannedTask[];
}
