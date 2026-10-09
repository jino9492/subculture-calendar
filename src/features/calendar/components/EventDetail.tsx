import { useEffect, useRef } from 'react';
import type { CalendarEvent } from '../types';
import { GAMES, KIND_LABELS } from '../utils/games';
import { formatEventEnd, formatTime } from '../utils/calendar';
import { EventImage } from './EventImage';
import { canComplete } from '../../completion';

interface EventDetailProps { event: CalendarEvent; isCompleted: boolean; onToggleCompletion: () => void; onClose: () => void }
export const EventDetail = ({ event, isCompleted, onToggleCompletion, onClose }: EventDetailProps) => {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  const isMilestone = event.kind === 'version' && Date.parse(event.endAt) - Date.parse(event.startAt) <= 1000;
  return <dialog ref={ref} className="event-dialog" onClose={onClose} onClick={(click) => { if (click.target === click.currentTarget) onClose(); }}>
    <div className="dialog-header"><img className="game-badge" src={GAMES[event.game].icon} alt="" />
      <span>{GAMES[event.game].name} / {KIND_LABELS[event.kind]}</span><button type="button" className="icon-button" onClick={onClose} aria-label="상세 닫기">×</button></div>
    <h2>{event.title}</h2>
    {canComplete(event) && <button type="button" className="detail-completion-button small-button" aria-pressed={isCompleted} onClick={onToggleCompletion}>{isCompleted ? '✓ 완료 · 체크 취소' : '완료 표시'}</button>}
    {Boolean(event.imageUrls?.length) && <div className="detail-images">{event.imageUrls?.map((url) =>
      <EventImage key={url} url={url} alt={event.title} className="detail-image" />)}</div>}
    <dl className="detail-dates"><div><dt>{isMilestone ? '예정 시작' : '시작'}</dt><dd>{formatTime(event.startAt)}</dd></div>
      <div><dt>종료</dt><dd>{isMilestone ? '—' : formatEventEnd(event)}</dd></div><div><dt>기준</dt><dd>아시아 서버 · 한국 시간</dd></div></dl>
    <a className="source-link" href={event.sourceUrl} target="_blank" rel="noreferrer">일정 출처 보기 ↗</a>
  </dialog>;
};
