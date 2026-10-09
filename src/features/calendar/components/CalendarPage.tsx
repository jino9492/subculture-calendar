import { useState } from 'react';
import { ThemeToggle } from '../../theme';
import { GAME_IDS, EVENT_KINDS } from '../../../../shared/calendar';
import { cn } from '../../../utils/cn';
import { useCalendar } from '../hooks/useCalendar';
import type { CalendarEvent } from '../types';
import { calendarRange, dayDate, dayNumber, eventEndDay, formatEventEnd, formatTime, intersectsDay, todayDay } from '../utils/calendar';
import { GAMES, KIND_LABELS } from '../utils/games';
import { EventDetail } from './EventDetail';
import { TimelineCalendar } from './TimelineCalendar';
import { canComplete, useCompletion } from '../../completion';
import { PlannerPanel } from '../../planner';

export const CalendarPage = () => {
  const calendar = useCalendar();
  const completion = useCompletion(calendar.data?.events ?? []);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const selectedDetail = selectedEvent ? calendar.data?.events.find((event) => event.id === selectedEvent.id
    || event.collectionSources?.some((source) => source.id === selectedEvent.id)) ?? selectedEvent : null;
  const range = calendarRange(calendar.events, calendar.now);
  const rangeEvents = range ? calendar.events.filter((event) => dayNumber(event.startAt) <= range.last && eventEndDay(event) >= range.first) : [];
  const formatRangeDate = (day: number) => dayDate(day).toISOString().slice(0, 10).replaceAll('-', '.');
  const dayEvents = calendar.events.filter((event) => intersectsDay(event, calendar.selectedDay)).sort((a, b) => a.endAt.localeCompare(b.endAt));
  const selectedDate = dayDate(calendar.selectedDay);
  const activeCount = calendar.events.filter((event) => Date.parse(event.startAt) <= calendar.now && Date.parse(event.endAt) > calendar.now).length;
  const endingCount = calendar.events.filter((event) => Date.parse(event.endAt) > calendar.now && Date.parse(event.endAt) <= calendar.now + 3 * 86400000).length;

  return <div className="app-shell">
    <aside className="sidebar">
      <a href="/" className="brand"><span className="brand-symbol">S<span>◷</span></span><span>SUBCULTURE<br /><b>CALENDAR</b></span></a>
      <div className="nav-current"><span>▦</span> 일정 캘린더 <span className="nav-dot" /></div>
      <div className="sidebar-section"><p className="section-label">게임 선택 <span>{calendar.games.length} / {GAME_IDS.length}</span></p>
        {GAME_IDS.map((game) => <button type="button" key={game} aria-pressed={calendar.games.includes(game)} onClick={() => calendar.toggleGame(game)}
          className={cn('game-filter', !calendar.games.includes(game) && 'filter-off')}>
          <img className="game-badge" src={GAMES[game].icon} alt="" /><span>{GAMES[game].name}</span>
          <span className="check-indicator">{calendar.games.includes(game) ? '✓' : '+'}</span>
        </button>)}
      </div>
      <div className="sidebar-note"><span>아시아 서버</span><p>표시 시간: 한국 시간 (UTC+9)</p></div>
    </aside>

    <main className="main-content">
      <header className="page-header"><div><h1>게임 일정</h1>
        <p className="page-subtitle">이벤트 · 픽업 · 엔드 콘텐츠 · 버전</p></div><div className="header-actions"><ThemeToggle /><span className="timezone-badge">한국 시간 <span>UTC+9</span></span></div></header>
      <section className="calendar-panel" aria-label="게임 일정 캘린더">
        <div className="calendar-toolbar"><div className="range-navigation"><h2>{range ? `${formatRangeDate(range.first)} ~ ${formatRangeDate(range.last)}` : '표시할 일정 없음'}</h2>
          <button type="button" className="small-button" onClick={calendar.goToday}>오늘</button></div>
          <div className="toolbar-actions"><label className="search-box"><span>⌕</span><input aria-label="일정 검색" placeholder="일정 검색" value={calendar.query} onChange={(event) => calendar.setQuery(event.target.value)} /></label>
            <button type="button" className="small-button" disabled={calendar.isLoading} onClick={() => void calendar.load()}>{calendar.isLoading ? '불러오는 중…' : '↻ 다시 불러오기'}</button></div>
        </div>
        <div className="type-toolbar"><div className="type-filters">{EVENT_KINDS.map((kind) => <button type="button" key={kind} aria-pressed={calendar.kinds.includes(kind)} onClick={() => calendar.toggleKind(kind)}
          className={cn('type-filter', `kind-${kind}`, calendar.kinds.includes(kind) && 'type-active')}>{KIND_LABELS[kind]}</button>)}</div><span>일정 분류 필터</span></div>
        {calendar.error && <p className="notice error-notice" role="alert">{calendar.error}</p>}
        {completion.storageError && <p className="notice error-notice" role="alert">{completion.storageError}</p>}
        {calendar.data?.status === 'stale' && <p className="notice" role="status">일부 일정을 갱신하지 못해 이전 데이터를 표시합니다.{calendar.data.updatedAt && ` 마지막 갱신: ${formatTime(calendar.data.updatedAt)}`}</p>}
        {calendar.data?.status === 'unavailable' && <p className="notice error-notice" role="alert">일정을 가져오지 못했습니다. 잠시 후 다시 불러와 주세요.</p>}
        {calendar.isLoading && !calendar.data && <p className="notice" role="status">일정 수집 중</p>}
        {range ? <TimelineCalendar {...range} now={calendar.now} selectedDay={calendar.selectedDay} focusRevision={calendar.focusRevision} events={calendar.events} endingEvents={calendar.selectedEvents} onSelectDay={calendar.selectDay} onSelectEvent={setSelectedEvent} isCompleted={completion.isCompleted} onToggleCompletion={completion.toggle} />
          : !calendar.isLoading && <p className="notice">진행 중이거나 예정된 일정이 없습니다.</p>}
        <div className="calendar-legend">{GAME_IDS.map((game) => <span key={game}><i className={cn('legend-dot', GAMES[game].className)} />{GAMES[game].name}</span>)}<span className="legend-help">일정 클릭: 완료 체크 · ⋯: 상세</span></div>
      </section>

      <div className="summary-grid"><div className="summary-card"><span>표시 범위 일정</span><strong>{rangeEvents.length}<small>개</small></strong><span className="summary-icon">▦</span></div>
        <div className="summary-card"><span>진행 중</span><strong>{activeCount}<small>개</small></strong><span className="summary-icon mint">◉</span></div>
        <div className="summary-card"><span>3일 내 종료</span><strong>{endingCount}<small>개</small></strong><span className="summary-icon ending-urgent">◷</span></div></div>

      <PlannerPanel events={calendar.selectedEvents} now={calendar.now} query={calendar.query} isCompleted={completion.isCompleted}
        onToggleCompletion={completion.toggle}
        gameLabel={(game) => GAMES[game].name} gameIcon={(game) => GAMES[game].icon} onSelectEvent={setSelectedEvent} onSelectTime={(at) => calendar.selectDay(dayNumber(new Date(at).toISOString()))} />
      <section className="day-panel"><div className="panel-heading"><h2>{selectedDate.getUTCMonth() + 1}월 {selectedDate.getUTCDate()}일 <span>{calendar.selectedDay === todayDay() ? '오늘의 일정' : '선택한 날짜'}</span></h2><span>{dayEvents.length}개</span></div>
        {dayEvents.length ? <div className="day-list">{dayEvents.map((event) => <div className={cn('day-event', completion.isCompleted(event) && 'task-completed')} key={event.id}>
          <button type="button" className="day-event-toggle" aria-pressed={canComplete(event) ? completion.isCompleted(event) : undefined} onClick={() => canComplete(event) ? completion.toggle(event) : setSelectedEvent(event)}>
          <img className="game-badge" src={GAMES[event.game].icon} alt="" />
          <span className="day-event-content"><span className="day-event-meta">{GAMES[event.game].name} · {KIND_LABELS[event.kind]}</span><strong>{completion.isCompleted(event) ? '✓ ' : ''}{event.title}</strong></span>
          <span className="day-event-end">{event.kind === 'version' && Date.parse(event.endAt) - Date.parse(event.startAt) <= 1000 ? '시작 시점' : `${formatEventEnd(event)} 종료`} <span>↗</span></span>
        </button><button type="button" className="event-detail-button" aria-label={`${event.title} 상세 보기`} onClick={() => setSelectedEvent(event)}>⋯</button></div>)}</div> : <p className="empty-day">이 날짜에는 표시할 일정이 없습니다.</p>}
      </section>
      <footer className="page-footer">SUBCULTURE CALENDAR <span>아시아 서버 · 한국 시간</span></footer>
    </main>
    {selectedDetail && <EventDetail event={selectedDetail} isCompleted={completion.isCompleted(selectedDetail)} onToggleCompletion={() => completion.toggle(selectedDetail)} onClose={() => setSelectedEvent(null)} />}
  </div>;
};
