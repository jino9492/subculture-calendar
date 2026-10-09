import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EVENT_KINDS, GAME_IDS } from '../../../../shared/calendar';
import { cn } from '../../../utils/cn';
import type { CalendarEvent } from '../types';
import { dayDate, dayNumber, endingCountdown, formatEventEnd, formatTime, groupEndingEvents, nearestEnding, packTimeRange, preserveTimelineScroll, timelineTimePosition } from '../utils/calendar';
import { GAMES, KIND_LABELS } from '../utils/games';
import { EventImage } from './EventImage';
import { allEndingTasksCompleted, canComplete } from '../../completion';

interface TimelineCalendarProps {
  first: number; last: number; days: number[]; now: number; selectedDay: number; focusRevision: number; events: CalendarEvent[];
  endingEvents: CalendarEvent[];
  onSelectDay: (day: number) => void; onSelectEvent: (event: CalendarEvent) => void;
  isCompleted: (event: CalendarEvent) => boolean; onToggleCompletion: (event: CalendarEvent) => void;
}
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export const TimelineCalendar = ({ first, last, days, now, selectedDay, focusRevision, events, endingEvents, onSelectDay, onSelectEvent, isCompleted, onToggleCompletion }: TimelineCalendarProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const previousView = useRef<{ first: number; last: number; selectedDay: number; focusRevision: number } | null>(null);
  const scrollPosition = useRef({ left: 0, top: 0 });
  const today = dayNumber(new Date(now).toISOString());
  const timePosition = timelineTimePosition(now, first, last);
  const layoutId = useId();
  const scope = `.timeline-calendar[data-layout="${layoutId}"]`;
  const gameGroups = GAME_IDS.map((game) => ({ game, groups: EVENT_KINDS.map((kind) => ({ kind,
    lanes: packTimeRange(events.filter((event) => event.game === game && event.kind === kind), first, last),
  })).filter((group) => group.lanes.length > 0) })).filter((group) => group.groups.length > 0);
  const segments = gameGroups.flatMap(({ groups }) => groups.flatMap(({ lanes }) => lanes.flat()));
  const layoutStyles = [
    `${scope} .timeline-tracks { width: calc(var(--timeline-day-width) * ${days.length}); }`,
    ...(timePosition ? [`${scope} .timeline-time-line { left: calc(var(--timeline-label-width) + var(--timeline-day-width) * ${timePosition.position}); }`] : []),
    ...segments.map((segment) => `${scope} .timeline-bar[data-start="${segment.start}"][data-end="${segment.end}"] { left: calc(var(--timeline-day-width) * ${segment.start}); width: calc(var(--timeline-day-width) * ${segment.end - segment.start}); }`),
  ].join('\n');
  const timeLine = timePosition && <div className="timeline-time-line" aria-hidden="true">
    <span className="timeline-time-label">{String(timePosition.hour).padStart(2, '0')}시</span>
  </div>;
  const endingGroups = groupEndingEvents(endingEvents, first, last);
  const [endingPreviewDay, setEndingPreviewDay] = useState<number | null>(null);
  const previewEvents = endingPreviewDay !== null ? endingGroups.get(endingPreviewDay) : undefined;
  const previewEnding = previewEvents ? nearestEnding(previewEvents, now) : undefined;
  const previewCountdown = previewEnding ? endingCountdown(previewEnding.endAt, now) : undefined;
  const previewCompleted = previewEvents ? allEndingTasksCompleted(previewEvents, isCompleted, now) : false;
  const previewCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleKeepPreview = () => {
    if (previewCloseTimer.current !== null) clearTimeout(previewCloseTimer.current);
    previewCloseTimer.current = null;
  };
  const handleClosePreview = () => {
    handleKeepPreview();
    setEndingPreviewDay(null);
  };
  useEffect(() => () => {
    if (previewCloseTimer.current !== null) clearTimeout(previewCloseTimer.current);
  }, []);

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    const selected = selectedRef.current;
    if (!scroll || !selected) return;
    const previous = previousView.current;
    previousView.current = { first, last, selectedDay, focusRevision };
    if (!previous || previous.selectedDay !== selectedDay || previous.focusRevision !== focusRevision) {
      const labelWidth = labelRef.current?.offsetWidth ?? 0;
      const target = selected.getBoundingClientRect().left - scroll.getBoundingClientRect().left + scroll.scrollLeft - labelWidth;
      scroll.scrollTo({ left: Math.max(0, target - (scroll.clientWidth - labelWidth) / 3), behavior: previous ? 'smooth' : 'instant' });
    } else if (previous.first !== first || previous.last !== last) {
      // 시작일 변경분을 보정해 화면에 보이던 날짜 위치 유지
      const left = preserveTimelineScroll(scrollPosition.current.left, previous.first, first, selected.offsetWidth, scroll.scrollWidth - scroll.clientWidth);
      scroll.scrollTo({ left, top: scrollPosition.current.top, behavior: 'instant' });
    }
    scrollPosition.current = { left: scroll.scrollLeft, top: scroll.scrollTop };
  }, [first, last, selectedDay, focusRevision]);

  const handleScroll = (direction: number) => {
    const scroll = scrollRef.current;
    if (scroll) scroll.scrollBy({ left: direction * scroll.clientWidth * 0.7, behavior: 'smooth' });
  };

  return <div className="timeline-calendar" data-layout={layoutId}
    onKeyDown={(event) => { if (event.key === 'Escape') handleClosePreview(); }}>
    <style>{layoutStyles}</style>
    <div className="timeline-controls"><span>게임 · 분류별 일정</span><div><span>날짜를 가로로 스크롤</span>
      <button type="button" className="icon-button" aria-label="앞쪽 날짜 보기" onClick={() => handleScroll(-1)}>‹</button>
      <button type="button" className="icon-button" aria-label="뒤쪽 날짜 보기" onClick={() => handleScroll(1)}>›</button></div></div>
    <div ref={scrollRef} className="timeline-scroll" tabIndex={0} aria-label="전체 일정 타임라인, 날짜를 가로로 스크롤"
      onScroll={(event) => { scrollPosition.current = { left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop }; }}>
      <div className="timeline-content" data-days={days.length}>
        <div className="timeline-date-header">
        <div className="timeline-row">
          <div ref={labelRef} className="timeline-label timeline-corner">게임 / 분류</div>
          {days.map((day) => {
            const date = dayDate(day);
            return <button type="button" key={day} ref={day === Math.max(first, Math.min(last, selectedDay)) ? selectedRef : undefined}
              onClick={() => onSelectDay(day)} aria-pressed={selectedDay === day}
              aria-label={`${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일 일정 보기`}
              className={cn('timeline-date', date.getUTCDay() === 0 && 'timeline-sunday', date.getUTCDay() === 6 && 'timeline-saturday',
                day === selectedDay && 'selected-date', day === today && 'timeline-today')}>
              <span className="timeline-month">{date.getUTCMonth() + 1}월</span><span className="day-number">{date.getUTCDate()}</span><span>{day === today ? '오늘' : WEEKDAYS[date.getUTCDay()]}</span>
            </button>;
          })}
        </div>
        <div className="timeline-ending-row timeline-row" aria-label="날짜별 종료 일정">
          <div className="timeline-label timeline-corner" title="선택 게임·분류 기준 집계. 제목 검색과 무관하게 전체 종료 일정 표시">종료 일정</div>
          {days.map((day) => {
            const ending = endingGroups.get(day);
            const nearest = ending ? nearestEnding(ending, now) : undefined;
            const countdown = nearest ? endingCountdown(nearest.endAt, now) : undefined;
            const isGroupCompleted = ending ? allEndingTasksCompleted(ending, isCompleted, now) : false;
            return <div className="timeline-ending-cell" key={day}>
              {ending && <button type="button" className={cn('ending-count', isGroupCompleted ? 'ending-completed' : `ending-${countdown?.tone}`, endingPreviewDay === day && 'ending-count-active')}
                aria-label={`${dayDate(day).getUTCMonth() + 1}월 ${dayDate(day).getUTCDate()}일 종료 일정 ${ending.length}개`}
                aria-expanded={endingPreviewDay === day && Boolean(previewEvents?.length)}
                aria-controls={endingPreviewDay === day && previewEvents?.length ? 'ending-preview' : undefined}
                onMouseEnter={() => { handleKeepPreview(); setEndingPreviewDay(day); }}
                onMouseLeave={(event) => {
                  const target = event.relatedTarget;
                  if (!(target instanceof Element && target.closest('.ending-preview'))) {
                    handleKeepPreview();
                    // 좌우 보정된 목록까지 포인터가 이동할 짧은 여유 확보
                    previewCloseTimer.current = setTimeout(handleClosePreview, 120);
                  }
                }}>
                종료 {ending.length}개
              </button>}
            </div>;
          })}
        </div>
        </div>
        <div className="timeline-body">
        {timeLine}
        {gameGroups.map(({ game, groups }) => {
          return <section className="timeline-game" key={game} aria-label={`${GAMES[game].name} 일정`}>
            <div className="timeline-game-heading"><img className="game-badge" src={GAMES[game].icon} alt="" /><h3>{GAMES[game].name}</h3></div>
            {groups.map(({ kind, lanes }) => <div className="timeline-group" key={kind} aria-label={`${GAMES[game].name} ${KIND_LABELS[kind]}`}>
              {lanes.map((lane, laneIndex) => <div className="timeline-lane timeline-row" key={lane[0]?.event.id}>
                <div className="timeline-label">{laneIndex === 0 && <><strong>{KIND_LABELS[kind]}</strong><span>{lanes.reduce((sum, row) => sum + row.length, 0)}개</span></>}</div>
                <div className="timeline-tracks">
                {lane.map((segment) =>
                  <div data-start={segment.start} data-end={segment.end}
                  key={segment.event.id}
                  className={cn('timeline-bar', segment.end - segment.start < 0.75 && 'timeline-short-bar', GAMES[game].className, isCompleted(segment.event) && 'task-completed', segment.continuesBefore && 'continues-before', segment.continuesAfter && 'continues-after')}>
                  <button type="button" className="timeline-task-toggle"
                  onClick={() => canComplete(segment.event) ? onToggleCompletion(segment.event) : onSelectEvent(segment.event)}
                  aria-pressed={canComplete(segment.event) ? isCompleted(segment.event) : undefined}
                  aria-label={`${GAMES[game].name} · ${segment.event.title} · ${canComplete(segment.event) ? isCompleted(segment.event) ? '완료 취소' : '완료 표시' : '상세 보기'}`}
                  title={`${segment.event.title}\n${formatTime(segment.event.startAt)} ~ ${kind === 'version' && Date.parse(segment.event.endAt) - Date.parse(segment.event.startAt) <= 1000 ? '종료 수집 누락' : formatEventEnd(segment.event)}`}
                  />
                  <span className="timeline-bar-content"><img className="game-badge task-game-icon" src={GAMES[game].icon} alt="" />{segment.event.imageUrls?.slice(0, 2).map((url) =>
                    <EventImage key={url} url={url} className="timeline-event-image" />)}
                    <span className="timeline-bar-text"><span className="timeline-bar-meta"><span className={cn('kind-badge', `kind-${kind}`)}>{KIND_LABELS[kind]}</span>{isCompleted(segment.event) && <span className="completion-mark">✓ 완료</span>}
                    <span>{segment.event.timeEvidence?.start?.basis === 'community-data' || segment.event.timeEvidence?.end?.basis === 'community-data' ? '공개 일정 · 시각 확인 필요 · ' : segment.event.periodBasis === 'community-cycle' ? '공개 주기 계산 · ' : segment.event.periodBasis === 'community-data' ? '공개 일정 · ' : ''}{segment.event.versionEndBasis === 'default-42-days' ? '42일 기본값 · ' : segment.event.versionEndBasis === 'announced-date' ? '공개 날짜 · 시각 확인 필요 · ' : ''}{segment.continuesBefore ? '‹ 표시 범위 이전부터' : ''}{segment.continuesAfter ? ' 표시 범위 이후까지 ›' : ''}</span></span>
                    <span className="timeline-bar-title">{segment.event.title}</span></span></span>
                    <button type="button" className="event-detail-button" aria-label={`${segment.event.title} 상세 보기`} onClick={() => onSelectEvent(segment.event)}>⋯</button>
                </div>)}
                </div>
              </div>)}
            </div>)}
          </section>;
        })}
        {!gameGroups.length && <div className="timeline-empty">표시할 일정 없음</div>}
        </div>
      </div>
    </div>
    {endingPreviewDay !== null && previewEvents?.length && createPortal(<section id="ending-preview" className={cn('ending-preview', previewCompleted ? 'ending-completed' : `ending-${previewCountdown?.tone}`)} aria-label="종료 일정 목록"
      onMouseEnter={handleKeepPreview}
      onMouseLeave={(event) => {
        const target = event.relatedTarget;
        if (!(target instanceof Element && target.closest('.ending-count-active'))) handleClosePreview();
      }}>
      <div className="ending-preview-heading"><h3>{dayDate(endingPreviewDay).getUTCMonth() + 1}월 {dayDate(endingPreviewDay).getUTCDate()}일 종료 · {previewEvents.length}개 · 완료 {previewEvents.filter(isCompleted).length}/{previewEvents.filter(canComplete).length}</h3>
        <span className="ending-remaining" title="아직 종료되지 않은 일정 중 가장 빠른 종료 기준">{previewEnding?.versionEndBasis === 'announced-date' ? '종료 시각 확인 필요' : previewCountdown?.label}</span></div>
      <div className="ending-preview-list">{previewEvents.map((event) => <div className={cn('ending-preview-event', isCompleted(event) && 'task-completed', isCompleted(event) && Date.parse(event.endAt) > now ? 'ending-completed' : `ending-${endingCountdown(event.endAt, now).tone}`)} key={event.id}>
        <button type="button" className="ending-preview-toggle" aria-pressed={canComplete(event) ? isCompleted(event) : undefined}
          onClick={() => { if (canComplete(event)) onToggleCompletion(event); else { handleClosePreview(); onSelectEvent(event); } }}>
        <span className="ending-preview-game"><img className="game-badge task-game-icon" src={GAMES[event.game].icon} alt="" /><span className="day-event-meta">{GAMES[event.game].name} · {KIND_LABELS[event.kind]}</span></span>
        <strong>{event.title}</strong><span className="ending-preview-time">{formatEventEnd(event)} 종료{event.versionEndBasis === 'default-42-days' ? ' · 42일 기본값' : ''}</span>
        </button><button type="button" className="preview-detail-button event-detail-button" aria-label={`${event.title} 상세 보기`} onClick={() => { handleClosePreview(); onSelectEvent(event); }}>⋯</button>
      </div>)}</div>
    </section>, document.body)}
  </div>;
};
