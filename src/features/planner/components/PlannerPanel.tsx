import type { CalendarEvent, GameId } from '../../../../shared/calendar';
import { canComplete } from '../../completion';
import { cn } from '../../../utils/cn';
import { buildHomeworkPlan, matchesPlannerSearch, nextVisitDeadline, attentionTasks } from '../algorithm';
import { usePlanner } from '../hooks/usePlanner';
import type { PlannedTask } from '../types';

interface PlannerPanelProps {
  events: CalendarEvent[]; now: number; query: string; isCompleted: (event: CalendarEvent) => boolean;
  gameLabel: (game: GameId) => string; gameIcon: (game: GameId) => string;
  onSelectEvent: (event: CalendarEvent) => void; onSelectTime: (at: number) => void;
  onToggleCompletion: (event: CalendarEvent) => void;
}
const formatAt = (at: number) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', weekday: 'short',
  hour: '2-digit', minute: '2-digit', ...(at % 60000 ? { second: '2-digit' as const } : {}), hour12: false }).format(at);

export const PlannerPanel = ({ events, now, query, isCompleted, gameLabel, gameIcon, onSelectEvent, onSelectTime, onToggleCompletion }: PlannerPanelProps) => {
  const planner = usePlanner();
  // 완료 체크에도 과제 행과 방문 배치를 유지하도록 전체 일정으로 계산
  const result = buildHomeworkPlan(events, () => false, planner.options, now);
  const remainingCount = result.remaining.filter((task) => !isCompleted(task.event)).length;
  const visits = result.visits.filter((visit) => visit.tasks.some((task) => matchesPlannerSearch(task, query)));
  const immediate = attentionTasks(result.immediate, query);
  const attention = attentionTasks(result.attention, query);
  const renderTaskButton = (event: CalendarEvent) => <div className="planner-task-controls"><button type="button" className="planner-task-name"
    aria-pressed={canComplete(event) ? isCompleted(event) : undefined}
    aria-label={`${gameLabel(event.game)} · ${event.title} · ${canComplete(event) ? isCompleted(event) ? '완료 취소' : '완료 표시' : '상세 보기'}`}
    onClick={() => canComplete(event) ? onToggleCompletion(event) : onSelectEvent(event)}>
    {canComplete(event) && <span className="planner-check" aria-hidden="true">{isCompleted(event) ? '✓' : '□'}</span>}
    <img className="game-badge" src={gameIcon(event.game)} alt="" />
    <span className="planner-task-text"><span>{gameLabel(event.game)}</span><strong>{event.title}</strong></span>
  </button><button type="button" className="event-detail-button" aria-label={`${event.title} 상세 보기`} onClick={() => onSelectEvent(event)}>⋯</button></div>;
  const renderTask = (task: PlannedTask) => <li key={task.event.id} className={cn('planner-task', isCompleted(task.event) && 'task-completed')}>{renderTaskButton(task.event)}</li>;
  return <section className="planner-panel" aria-label="몰아서 할 날짜 추천">
    <div className="planner-heading"><div><h2>몰아서 할 날짜</h2><p>미완료 {remainingCount}개 · 추천 방문 {result.visits.length}회</p></div>
      <label className="planner-checkbox"><input type="checkbox" checked={planner.options.includeBanners} onChange={(event) => planner.setOptions({ includeBanners: event.target.checked })} />픽업 포함</label></div>
    <div className="planner-settings">
      <label>마감 여유<select value={planner.options.marginHours} onChange={(event) => planner.setOptions({ marginHours: Number(event.target.value) })}>{[0, 6, 12, 24, 48, 72].map((hours) => <option key={hours} value={hours}>{hours}시간</option>)}</select></label>
      <label>가능한 시간<select value={planner.options.availability} onChange={(event) => { const availability = event.target.value; if (availability === 'any' || availability === 'daily' || availability === 'weekends') planner.setOptions({ availability }); }}><option value="any">언제든 가능</option><option value="daily">매일 지정 시각</option><option value="weekends">주말 지정 시각</option></select></label>
      {planner.options.availability !== 'any' && <label>한국 시간<select value={planner.options.hourKst} onChange={(event) => planner.setOptions({ hourKst: Number(event.target.value) })}>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}</select></label>}
    </div>
    {planner.error && <p className="planner-warning" role="alert">{planner.error}</p>}
    <p className="planner-note">수행 조건은 확인하지 않으니 주의 바랍니다.</p>
    {!result.remaining.length && <p className="planner-empty">추천할 과제가 없습니다.</p>}
    {result.remaining.length > 0 && !visits.length && !immediate.length && !attention.length && <p className="planner-empty">검색에 맞는 추천 과제가 없습니다.</p>}
    {immediate.length > 0 && <div className="planner-attention"><h3>즉시 확인 · 마감 여유 부족</h3><ul>{immediate.map((item) => <li key={item.task.event.id} className={cn(isCompleted(item.task.event) && 'task-completed')}>{renderTaskButton(item.task.event)}<p>{item.reason}</p></li>)}</ul></div>}
    <div className="planner-visits">{visits.map((visit, index) => {
      const tasks = visit.tasks.filter((task) => matchesPlannerSearch(task, query));
      const games = [...new Set(visit.tasks.map((task) => task.event.game))];
      const pendingTasks = visit.tasks.filter((task) => !isCompleted(task.event));
      return <details className="planner-visit" key={visit.at} open={index === 0}><summary><strong>{formatAt(visit.at)}</strong><span>{visit.tasks.length}개 과제 · {games.map((game) => `${gameLabel(game)} ${visit.tasks.filter((task) => task.event.game === game).length}`).join(' / ')}</span></summary>
        <div className="planner-visit-meta"><span>{pendingTasks.length ? `다음 마감 ${formatAt(nextVisitDeadline({ ...visit, tasks: pendingTasks }))}` : '모두 완료'}</span><button type="button" className="small-button" onClick={() => onSelectTime(visit.at)}>캘린더에서 보기</button></div>
        <ul>{tasks.map(renderTask)}</ul></details>;
    })}</div>
    {attention.length > 0 && <div className="planner-attention"><h3>일정 충돌</h3><ul>{attention.map((item) => <li key={item.task.event.id} className={cn(isCompleted(item.task.event) && 'task-completed')}>{renderTaskButton(item.task.event)}<p>{item.reason}</p></li>)}</ul></div>}
    {query.trim() && <p className="planner-note">검색은 결과 목록만 거릅니다. 방문 계산은 선택한 게임·분류 전체를 기준으로 합니다.</p>}
  </section>;
};
