import { useState, type FormEvent } from 'react';
import { EVENT_KINDS, GAME_IDS, type CalendarEvent, type EventKind, type GameId } from '../../../../shared/calendar';
import { type AdminAction, type CollectionIssue, type EventOverride } from '../../../../shared/admin';
import { GAMES, KIND_LABELS } from '../../calendar';
import { fromKoreanInput, toKoreanInput } from '../utils';

interface EventEditorProps {
  event?: CalendarEvent;
  issue?: CollectionIssue;
  override?: EventOverride;
  isBusy: boolean;
  onSave: (action: AdminAction) => Promise<boolean>;
  onClose: () => void;
}
export const EventEditor = ({ event, issue, override, isBusy, onSave, onClose }: EventEditorProps) => {
  const [game, setGame] = useState<GameId>(event?.game ?? issue?.game ?? 'genshin');
  const [kind, setKind] = useState<EventKind>(event?.kind ?? 'event');
  const [title, setTitle] = useState(event?.title ?? issue?.title ?? '');
  const [start, setStart] = useState(event ? toKoreanInput(event.startAt) : '');
  const [end, setEnd] = useState(event ? toKoreanInput(event.endAt) : '');
  const [sourceUrl, setSourceUrl] = useState(event?.sourceUrl ?? issue?.sourceUrl ?? '');
  const [description, setDescription] = useState(event?.description ?? '');
  const [language, setLanguage] = useState(event?.displayLanguage ?? event?.sourceLanguage ?? 'ko-kr');
  const [hidden, setHidden] = useState(override?.hidden ?? false);
  const [note, setNote] = useState('');
  const [validation, setValidation] = useState('');
  const handleSubmit = async (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    const startAt = fromKoreanInput(start);
    const endAt = fromKoreanInput(end);
    if (!startAt || !endAt || endAt <= startAt) { setValidation('종료 시간은 시작 시간보다 늦어야 합니다.'); return; }
    const saved = await onSave({ action: 'save', event: { id: event?.id ?? `manual:${crypto.randomUUID()}`, game, kind,
      title: title.trim(), startAt, endAt, sourceUrl: sourceUrl.trim(), description,
      sourceLanguage: event && !event.sourceLanguage.startsWith('ko') ? event.sourceLanguage : language,
      ...(language === 'ko-kr' ? { displayLanguage: 'ko-kr' } : {}),
      ...(event?.localizationKey ? { localizationKey: event.localizationKey } : {}),
      ...(event?.imageUrls ? { imageUrls: event.imageUrls } : {}),
      ...(event?.periodBasis && event.startAt === startAt && event.endAt === endAt ? { periodBasis: event.periodBasis } : {}),
      ...(kind === 'version' ? { versionEndBasis: event?.kind === 'version' && Date.parse(event.startAt) === Date.parse(startAt) && Date.parse(event.endAt) === Date.parse(endAt)
        ? event.versionEndBasis : 'manual', ...(event?.versionEndSourceUrl ? { versionEndSourceUrl: event.versionEndSourceUrl } : {}) } : {}) }, hidden, issueId: issue?.id, note });
    if (saved) onClose();
  };
  const handleReset = async () => { if (event && await onSave({ action: 'reset', id: event.id })) onClose(); };
  return <section className="admin-editor" aria-label="일정 편집">
    <div className="panel-heading"><h2>{event ? '일정 보정' : '수동 일정 추가'}</h2><button type="button" className="small-button" disabled={isBusy} onClick={onClose}>닫기</button></div>
    <p className="admin-help">시간은 한국 시간(UTC+9)으로 입력합니다. 저장한 내용은 재수집 후에도 유지됩니다.</p>
    {event?.versionEndBasis === 'announced-date' && <p className="admin-help">종료는 공지에서 날짜만 확인했습니다. 입력칸의 00:00은 날짜 경계입니다. 정확한 시각을 확인한 경우에만 수정하세요.</p>}
    {issue && <p className="admin-help">이 공지에 여러 기간이 있다면 일정별로 추가하세요. 같은 기간의 영문 일정이 있다면 전체 일정에서 보정하세요. 저장 시 공지를 처리 완료로 표시하며, 필요하면 다시 미처리로 변경할 수 있습니다.</p>}
    <form className="admin-form" onSubmit={(submitEvent) => void handleSubmit(submitEvent)}>
      <div className="admin-fields"><label>게임<select value={game} disabled={Boolean(event)} onChange={(change) => { const value = GAME_IDS.find((id) => id === change.target.value); if (value) setGame(value); }}>{GAME_IDS.map((id) => <option key={id} value={id}>{GAMES[id].name}</option>)}</select></label>
        <label>분류<select value={kind} onChange={(change) => { const value = EVENT_KINDS.find((id) => id === change.target.value); if (value) setKind(value); }}>{EVENT_KINDS.map((id) => <option key={id} value={id}>{KIND_LABELS[id]}</option>)}</select></label></div>
      <label>일정 제목<input value={title} maxLength={500} required onChange={(change) => setTitle(change.target.value)} /></label>
      <div className="admin-fields"><label>시작<input type="datetime-local" step="1" value={start} required onChange={(change) => setStart(change.target.value)} /></label>
        <label>종료<input type="datetime-local" step="1" value={end} required onChange={(change) => setEnd(change.target.value)} /></label></div>
      <label>출처 URL<input type="url" pattern="https://.*" value={sourceUrl} required maxLength={2000} onChange={(change) => setSourceUrl(change.target.value)} /></label>
      <label>설명<textarea rows={4} value={description} maxLength={6000} onChange={(change) => setDescription(change.target.value)} /></label>
      <label>표시 언어<select value={language} onChange={(change) => setLanguage(change.target.value)}>
        {!['ko-kr', 'en'].includes(language) && <option value={language}>{language}</option>}<option value="ko-kr">한국어 · 번역 확인 완료</option><option value="en">영문 · 확인 필요</option></select></label>
      <label>처리 메모<textarea rows={2} value={note} maxLength={3000} onChange={(change) => setNote(change.target.value)} placeholder="확인한 기간·번역 근거" /></label>
      <label className="admin-checkbox"><input type="checkbox" checked={hidden} onChange={(change) => setHidden(change.target.checked)} />캘린더에서 숨기기</label>
      {validation && <p className="source-error" role="alert">{validation}</p>}
      <div className="admin-actions"><button type="submit" className="source-link" disabled={isBusy}>{issue ? '저장 · 처리 완료' : '저장'}</button>
        {override && <button type="button" className="small-button" disabled={isBusy} onClick={() => void handleReset()}>{event?.id.startsWith('manual:') ? '추가 일정 제거' : '보정 해제 · 원본 복원'}</button>}</div>
    </form>
  </section>;
};
