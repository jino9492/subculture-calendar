import type { CalendarEvent } from '../../../shared/calendar';
import type { AttentionTask, PlannedTask, PlannerOptions, PlanResult, Visit } from './types';

const DAY = 86400000;
const HOUR = 3600000;
const KST = 9 * HOUR;
const weekday = (day: number) => new Date(day * DAY).getUTCDay();
export const latestAvailableAt = (release: number, deadline: number, options: PlannerOptions): number | undefined => {
  if (release > deadline) return undefined;
  if (options.availability === 'any') return deadline;
  let day = Math.floor((deadline + KST) / DAY);
  let at = day * DAY + options.hourKst * HOUR - KST;
  if (at > deadline) day--;
  if (options.availability === 'weekends') while (weekday(day) !== 0 && weekday(day) !== 6) day--;
  at = day * DAY + options.hourKst * HOUR - KST;
  return at >= release ? at : undefined;
};
const nextAvailableAt = (release: number, deadline: number, options: PlannerOptions) => {
  if (options.availability === 'any') return release <= deadline ? release : undefined;
  let day = Math.floor((release + KST) / DAY);
  if (day * DAY + options.hourKst * HOUR - KST < release) day++;
  if (options.availability === 'weekends') while (weekday(day) !== 0 && weekday(day) !== 6) day++;
  const at = day * DAY + options.hourKst * HOUR - KST;
  return at <= deadline ? at : undefined;
};

interface Interval { task: PlannedTask; release: number; deadline: number }
export const buildHomeworkPlan = (events: CalendarEvent[], isCompleted: (event: CalendarEvent) => boolean,
  options: PlannerOptions, now: number): PlanResult => {
  const result: PlanResult = { visits: [], immediate: [], attention: [], remaining: [] };
  const intervals: Interval[] = [];

  const orderedEvents = [...events].sort((a, b) => Date.parse(a.endAt) - Date.parse(b.endAt) || a.id.localeCompare(b.id));
  for (const event of orderedEvents) {
    if (event.kind === 'version' || event.kind === 'banner' && !options.includeBanners || isCompleted(event) || Date.parse(event.endAt) <= now) continue;
    const task: PlannedTask = { event };
    result.remaining.push(task);
    const release = Math.max(now, Date.parse(event.startAt));
    const end = Date.parse(event.endAt);
    const deadline = Math.min(end - 1, end - options.marginHours * HOUR);
    if (release >= end) { result.attention.push({ task, reason: '시작 시각이 종료 시각 이후' }); continue; }
    if (release > deadline) {
      if (release > now) { result.attention.push({ task, reason: '시작 후 마감 여유 시간 확보 불가' }); continue; }
      const at = nextAvailableAt(now, end - 1, options);
      result.immediate.push({ task, reason: at === undefined ? '마감 여유 지남 · 종료 전 가능한 시간이 없어 즉시 확인 필요'
        : at === now ? '마감 여유 지남 · 지금 처리' : `마감 여유 지남 · ${new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(at)}에 처리` });
      continue;
    }
    const at = latestAvailableAt(release, deadline, options);
    if (at === undefined) { result.attention.push({ task, reason: '유효 기간 안에 설정한 접속 시간이 없음' }); continue; }
    intervals.push({ task, release, deadline: at });
  }
  // 가장 이른 마감의 마지막 허용 시점으로 덮어 단일 수행 구간의 최소 방문 횟수 계산
  intervals.sort((a, b) => a.deadline - b.deadline || a.task.event.id.localeCompare(b.task.event.id));
  for (const interval of intervals) {
    let visit = result.visits.at(-1);
    if (!visit || visit.at < interval.release) { visit = { at: interval.deadline, tasks: [] }; result.visits.push(visit); }
    visit.tasks.push(interval.task);
  }

  result.visits.sort((a, b) => a.at - b.at);
  for (const visit of result.visits) visit.tasks.sort((a, b) => Date.parse(a.event.endAt) - Date.parse(b.event.endAt) || a.event.id.localeCompare(b.event.id));
  return result;
};

export const nextVisitDeadline = (visit: Visit) => Math.min(...visit.tasks.map((task) => Date.parse(task.event.endAt)));
export const matchesPlannerSearch = (task: PlannedTask, query: string) => task.event.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
export const attentionTasks = (items: AttentionTask[], query: string) => items.filter((item) => matchesPlannerSearch(item.task, query));
