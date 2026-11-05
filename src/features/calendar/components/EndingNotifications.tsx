import { useEffect, useRef, useState } from 'react';
import type { CalendarEvent } from '../types';
import { dayDate, dayNumber, endingCountdown, formatEventEnd, isEstimatedPeriod } from '../utils/calendar';
import { endingNotifications } from '../utils/notifications';
import { GAMES, KIND_LABELS } from '../utils/games';

interface EndingNotificationsProps {
  events: CalendarEvent[];
  now: number;
  isLoading: boolean;
  isUnavailable: boolean;
  isCompleted: (event: CalendarEvent) => boolean;
  onSelectEvent: (event: CalendarEvent) => void;
}

export const EndingNotifications = ({ events, now, isLoading, isUnavailable, isCompleted, onSelectEvent }: EndingNotificationsProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  const groups = endingNotifications(events, now, isCompleted);
  const count = groups.reduce((total, [, items]) => total + items.length, 0);
  const today = dayNumber(new Date(now).toISOString());
  useEffect(() => {
    if (isOpen) ref.current?.showModal();
    else ref.current?.close();
  }, [isOpen]);

  return <>
    <button type="button" className="icon-button notification-trigger" aria-label={`종료 임박 알림${count ? ` ${count}개` : ''}`}
      aria-haspopup="dialog" aria-expanded={isOpen} aria-controls="ending-notifications" onClick={() => setIsOpen(true)}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4M12 2V1" />
      </svg>
      {count > 0 && <span className="notification-badge" aria-hidden="true">{count > 99 ? '99+' : count}</span>}
    </button>
    <dialog ref={ref} id="ending-notifications" className="notification-dialog" aria-labelledby="notification-title" aria-describedby="notification-description"
      onClose={() => setIsOpen(false)} onClick={(event) => { if (event.target === event.currentTarget) setIsOpen(false); }}>
      <div className="notification-header"><div><h2 id="notification-title">종료 임박 알림 <span>{count}</span></h2>
        <p id="notification-description">앞으로 3일 내 종료 · 한국 시간 기준</p></div>
        <button type="button" className="icon-button" aria-label="알림 닫기" autoFocus onClick={() => setIsOpen(false)}>×</button></div>
      <p className="notification-filter-note">선택한 게임·일정 분류 기준 · 완료한 일정 제외</p>
      <div className="notification-body">
        {groups.length ? groups.map(([day, items]) => <section className="notification-group" key={day} aria-labelledby={`notification-day-${day}`}>
          <h3 id={`notification-day-${day}`}><span>{day === today ? '오늘 · ' : day === today + 1 ? '내일 · ' : ''}{new Intl.DateTimeFormat('ko-KR', {
            timeZone: 'UTC', month: 'long', day: 'numeric', weekday: 'short',
          }).format(dayDate(day))}</span><span>{items.length}개</span></h3>
          <ul>{items.map((event) => <li key={event.id}><button type="button" className="notification-event" onClick={() => { setIsOpen(false); onSelectEvent(event); }}>
            <img className="game-badge" src={GAMES[event.game].icon} alt="" />
            <span className="notification-event-content"><span className="notification-event-meta">{GAMES[event.game].name} · {KIND_LABELS[event.kind]}</span>
              <strong>{event.title}</strong><span className="notification-event-meta">{formatEventEnd(event)} 종료{isEstimatedPeriod(event) ? ' · 예상 기간' : ''}</span></span>
            <span className="notification-remaining">{endingCountdown(event.endAt, now).label}<span aria-hidden="true">↗</span></span>
          </button></li>)}</ul>
        </section>) : <div className="notification-empty"><strong>{isLoading ? '일정을 불러오는 중이에요' : isUnavailable ? '일정을 불러오지 못했어요' : '종료가 임박한 일정이 없어요'}</strong>
          <p>{isLoading ? '잠시만 기다려 주세요.' : isUnavailable ? '다시 불러오기로 재시도해 주세요.' : '3일 내 종료되는 미완료 일정이 여기에 표시됩니다.'}</p></div>}
      </div>
    </dialog>
  </>;
};
