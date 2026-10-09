import { useEffect, useState } from 'react';
import { GAME_IDS } from '../../../../shared/calendar';
import { isRunPage, RUN_CAUSES, RUN_STATES, type RunPage } from '../../../../shared/collection-runs';
import { GAMES } from '../../calendar';
import { koreanDate } from '../utils';

const CAUSES = { startup: '서버 시작', scheduled: '예약 실행', manual: '수동 재수집', 'request-expired': '조회 중 캐시 만료' };
const STATES = { running: '수집 중', ok: '성공', partial: '일부 확인 필요', stale: '실패 · 이전 데이터', error: '실패' };
export const CollectionLogs = () => {
  const [game, setGame] = useState(''); const [state, setState] = useState(''); const [cause, setCause] = useState('');
  const [page, setPage] = useState(1); const [revision, setRevision] = useState(0);
  const [data, setData] = useState<RunPage | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let loading = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      setBusy(true); setError('');
      try {
        const response = await fetch(`/api/admin/logs?${new URLSearchParams({ game, state, cause, page: String(page) })}`, { signal: controller.signal });
        if (!response.ok) throw new Error('Log request failed');
        const result: unknown = await response.json();
        if (!isRunPage(result)) throw new Error('Invalid log response');
        if (!controller.signal.aborted) setData(result);
      } catch { if (!controller.signal.aborted) setError('수집 로그를 불러오지 못했습니다. 다시 조회해 주세요.'); }
      finally { loading = false; if (!controller.signal.aborted) setBusy(false); }
    };
    void load(); const timer = setInterval(() => { void load(); }, 15000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [game, state, cause, page, revision]);
  const scheduler = data?.scheduler;
  return <section className="collection-log-panel" aria-label="수집 실행 로그">
    <div className="admin-toolbar"><strong>수집 로그</strong><button className="small-button" type="button" disabled={busy} onClick={() => setRevision((value) => value + 1)}>다시 조회</button>
      <label>게임<select value={game} onChange={(event) => { setGame(event.target.value); setPage(1); }}><option value="">전체</option>{GAME_IDS.map((id) => <option value={id} key={id}>{GAMES[id].name}</option>)}</select></label>
      <label>상태<select value={state} onChange={(event) => { setState(event.target.value); setPage(1); }}><option value="">전체</option>{RUN_STATES.map((id) => <option value={id} key={id}>{STATES[id]}</option>)}</select></label>
      <label>실행 원인<select value={cause} onChange={(event) => { setCause(event.target.value); setPage(1); }}><option value="">전체</option>{RUN_CAUSES.map((id) => <option value={id} key={id}>{CAUSES[id]}</option>)}</select></label></div>
    {error && <p className="notice error-notice" role="alert">{error}</p>}
    {scheduler?.storageError && <p className="notice error-notice" role="alert">{scheduler.storageError}</p>}
    {scheduler && <><p className="admin-help">{scheduler.enabled ? '자동 수집 활성' : '자동 수집 중지'} · 기본 {scheduler.intervalMs / 60000}분 · {scheduler.running ? '자동 수집 중' : `다음 실행 ${scheduler.nextRunAt ? koreanDate(scheduler.nextRunAt) : '없음'}`} · 15초마다 로그 갱신</p>
      <div className="collection-log-games">{scheduler.games.map((item) => <div key={item.game}><strong>{GAMES[item.game].name}</strong><p>최근 성공 {item.lastSuccessAt ? koreanDate(item.lastSuccessAt) : '없음'}</p><p>최근 실패 {item.lastFailureAt ? koreanDate(item.lastFailureAt) : '없음'}</p><p>다음 {item.nextRunAt ? koreanDate(item.nextRunAt) : '없음'} · 연속 실패 {item.failures}회</p></div>)}</div></>}
    <p className="admin-help">실제 원본 요청만 기록합니다. 캐시 조회와 진행 중인 수집에 합류한 요청은 중복 기록하지 않습니다. 추가·변경·삭제 수는 ID 기준 후보이며, 최초 수집은 비교 기준이 없습니다. 출처 누락으로 빠진 항목은 삭제 확정이 아닙니다.</p>
    <div className="collection-log-table"><table><thead><tr><th>게임·실행</th><th>시각·소요</th><th>상태</th><th>수집·병합·제외·확인</th><th>변경 후보</th></tr></thead><tbody>{data?.runs.map((run) => <tr key={run.id}>
      <td><strong>{GAMES[run.game].name}</strong><p>{CAUSES[run.cause]}</p><small>{run.id}</small></td>
      <td><p>예정 {run.scheduledAt ? koreanDate(run.scheduledAt) : '즉시 실행'}</p><p>시작 {koreanDate(run.startedAt)}</p><p>종료 {run.endedAt ? koreanDate(run.endedAt) : '진행 중'}</p><small>{(run.durationMs / 1000).toFixed(1)}초</small></td>
      <td><strong>{STATES[run.state]}</strong><p>{run.summary}</p></td><td>{run.collected} / {run.merged} / {run.skipped} / {run.issues}</td>
      <td>추가 {run.added} · 변경 {run.changed} · 삭제 후보 {run.removedCandidates}{!run.hadPrevious && <p>최초 수집</p>}</td>
    </tr>)}</tbody></table></div>
    {data && !data.runs.length && <p className="admin-help">조건에 맞는 수집 로그가 없습니다.</p>}
    <div className="admin-actions"><button type="button" className="small-button" disabled={busy || !data || data.page <= 1} onClick={() => setPage(Math.max(1, (data?.page ?? 1) - 1))}>이전</button><span>{data?.page ?? page} / {Math.max(1, Math.ceil((data?.total ?? 0) / 30))} · {data?.total ?? 0}건</span><button type="button" className="small-button" disabled={busy || !data || data.page * data.pageSize >= data.total} onClick={() => setPage((data?.page ?? 1) + 1)}>다음</button></div>
  </section>;
};
