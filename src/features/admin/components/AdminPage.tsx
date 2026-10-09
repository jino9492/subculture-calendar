import { useState } from 'react';
import { ThemeToggle } from '../../theme';
import { GAME_IDS, type CalendarEvent, type GameId } from '../../../../shared/calendar';
import { type CollectionIssue } from '../../../../shared/admin';
import { GAMES, KIND_LABELS } from '../../calendar';
import { cn } from '../../../utils/cn';
import { useAdmin } from '../hooks/useAdmin';
import { koreanDate } from '../utils';
import { EventEditor } from './EventEditor';
import { IssueDetail } from './IssueDetail';
import { CollectionLogs } from './CollectionLogs';

interface EditorSelection { event?: CalendarEvent; issue?: CollectionIssue; key: string }
export const AdminPage = () => {
  const admin = useAdmin();
  const [game, setGame] = useState<GameId | 'all'>('all');
  const [tab, setTab] = useState<'issues' | 'events' | 'logs'>('issues');
  const [status, setStatus] = useState('pending');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [editor, setEditor] = useState<EditorSelection | null>(null);
  if (!admin.data) return <main className="admin-shell">
    <a href="/" className="admin-back">← 일정 캘린더</a>
    {admin.accessDenied ? <>
      <h1>접근이 제한되었습니다</h1>
      <p className="notice error-notice" role="alert">{admin.error}</p>
    </> : admin.error ? <>
      <p className="notice error-notice" role="alert">관리자 접근을 확인하지 못했습니다. 서버 연결을 확인한 뒤 다시 시도해 주세요.</p>
      <button className="small-button" type="button" disabled={admin.isBusy} onClick={() => void admin.request()}>다시 시도</button>
    </> : <p className="notice" role="status">관리자 접근을 확인하는 중…</p>}
  </main>;
  const state = admin.data?.management;
  const issues = admin.data?.issues ?? [];
  const pendingCount = issues.filter((issue) => !state?.reviews[issue.id]).length;
  const selected = issues.find((issue) => issue.id === selectedId);
  const events = new Map((admin.data?.collectedEvents ?? []).map((event) => [event.id, event]));
  for (const override of Object.values(state?.overrides ?? {})) events.set(override.event.id, override.event);
  const matches = (item: { game: GameId; title: string }) => (game === 'all' || game === item.game) && item.title.toLowerCase().includes(query.toLowerCase());
  const filteredIssues = issues.filter((issue) => matches(issue) && (status === 'all' || (state?.reviews[issue.id]?.status ?? 'pending') === status));
  const filteredEvents = [...events.values()].filter(matches).sort((a, b) => b.startAt.localeCompare(a.startAt));
  const handleEditIssue = () => {
    if (!selected) return;
    setEditor({ issue: selected, event: selected.eventId ? events.get(selected.eventId) : undefined, key: `issue:${selected.id}:${Date.now()}` });
  };
  return <div className="admin-shell">
    <header className="admin-header"><div><a href="/" className="admin-back">← 일정 캘린더</a><h1>수집 관리</h1><p>확인 항목 · 일정 보정 · 수동 추가</p></div>
      <div className="admin-actions"><ThemeToggle /><button className="small-button" type="button" disabled={admin.isBusy} onClick={() => void admin.request('refresh')}>{admin.isBusy ? '처리 중…' : '원본 재수집'}</button>
        <button className="small-button" type="button" disabled={admin.isBusy} onClick={() => setEditor({ key: `new:${Date.now()}` })}>+ 일정 추가</button></div></header>
    <p className="admin-help">로컬 관리자 페이지 · 보정·처리 기록은 서버에 저장됩니다. 수집 범위 제한은 자동으로 해소되지 않습니다.</p>
    {admin.error && <p className="notice error-notice" role="alert">{admin.error}</p>}
    {admin.message && <p className="notice" role="status">{admin.message}</p>}
    <section className="admin-sources" aria-label="게임별 수집 상태">{admin.data?.sources.map((source) => <button type="button" key={source.game} onClick={() => setGame(game === source.game ? 'all' : source.game)}
      className={cn('admin-source-card', game === source.game && 'admin-selected')} aria-pressed={game === source.game}>
      <span>{GAMES[source.game].name}</span><strong className={cn('source-state', source.state === 'ok' ? 'source-ok' : source.state === 'partial' ? 'source-partial' : 'source-error')}>
        {({ ok: '연결됨', partial: '일부 확인 필요', stale: '이전 데이터', error: '연결 실패' })[source.state]}</strong>
      <p>{source.message}</p><small>{source.fetchedAt ? koreanDate(source.fetchedAt) : '수집된 데이터 없음'} · 제외 {source.skipped}개</small></button>)}</section>
    <div className="admin-toolbar"><div className="type-filters"><button type="button" className={cn('type-filter', tab === 'issues' && 'type-active')} onClick={() => setTab('issues')}>확인 항목 {pendingCount}</button>
      <button type="button" className={cn('type-filter', tab === 'events' && 'type-active')} onClick={() => setTab('events')}>전체 일정 {events.size}</button>
      <button type="button" className={cn('type-filter', tab === 'logs' && 'type-active')} onClick={() => setTab('logs')}>수집 로그</button></div>
      {tab !== 'logs' && <label>게임<select aria-label="게임 필터" value={game} onChange={(change) => setGame(GAME_IDS.find((id) => id === change.target.value) ?? 'all')}><option value="all">전체 게임</option>{GAME_IDS.map((id) => <option key={id} value={id}>{GAMES[id].name}</option>)}</select></label>}
      {tab === 'issues' && <label>처리 상태<select value={status} onChange={(change) => setStatus(change.target.value)}><option value="pending">미처리</option><option value="resolved">처리 완료</option><option value="ignored">제외</option><option value="all">전체</option></select></label>}
      {tab !== 'logs' && <label className="search-box"><input aria-label="관리 항목 검색" value={query} placeholder="제목 검색" onChange={(change) => setQuery(change.target.value)} /></label>}</div>
    {tab === 'logs' ? <CollectionLogs /> : <div className="admin-workspace"><section className="admin-list" aria-label={tab === 'issues' ? '확인 항목 목록' : '일정 목록'}>
      {tab === 'issues' ? filteredIssues.map((issue) => <button type="button" className={cn('admin-list-item', selectedId === issue.id && !editor && 'admin-selected')} key={issue.id}
        onClick={() => { setSelectedId(issue.id); setEditor(null); }}>
        <span>{GAMES[issue.game].name} · {state?.reviews[issue.id] ? state.reviews[issue.id]?.status === 'resolved' ? '처리 완료' : '제외' : '미처리'}</span><strong>{issue.title}</strong><p>{issue.reason}</p></button>)
        : filteredEvents.map((event) => <button type="button" className={cn('admin-list-item', editor?.event?.id === event.id && 'admin-selected')} key={event.id}
          onClick={() => setEditor({ event, key: `event:${event.id}:${Date.now()}` })}>
          <span>{GAMES[event.game].name} · {KIND_LABELS[event.kind]}{state?.overrides[event.id] ? state.overrides[event.id]?.hidden ? ' · 숨김' : event.id.startsWith('manual:') ? ' · 수동 추가' : ' · 보정' : ''}</span>
          <strong>{event.title}</strong><p>{koreanDate(event.startAt)} ~ {koreanDate(event.endAt)}</p></button>)}
      {admin.data && !(tab === 'issues' ? filteredIssues.length : filteredEvents.length) && <p className="admin-help">조건에 맞는 항목이 없습니다.</p>}
    </section>
      {editor ? <EventEditor key={editor.key} event={editor.event} issue={editor.issue} override={editor.event ? state?.overrides[editor.event.id] : undefined} isBusy={admin.isBusy} onSave={admin.request} onClose={() => setEditor(null)} />
        : selected ? <IssueDetail key={`${selected.id}:${state?.reviews[selected.id]?.updatedAt ?? ''}`} issue={selected} review={state?.reviews[selected.id]} isBusy={admin.isBusy} onSave={admin.request} onEdit={handleEditIssue} />
          : <section className="admin-editor"><p className="admin-help">확인 항목 또는 일정을 선택하세요. 원문 확인 후 기간·제목을 보정할 수 있습니다.</p></section>}
    </div>}
  </div>;
};
