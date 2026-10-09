import { useState } from 'react';
import { type AdminAction, type CollectionIssue, type Review } from '../../../../shared/admin';
import { GAMES } from '../../calendar';
import { koreanDate } from '../utils';

interface IssueDetailProps {
  issue: CollectionIssue;
  review?: Review;
  isBusy: boolean;
  onSave: (action: AdminAction) => Promise<boolean>;
  onEdit: () => void;
}
export const IssueDetail = ({ issue, review, isBusy, onSave, onEdit }: IssueDetailProps) => {
  const [note, setNote] = useState(review?.note ?? '');
  return <section className="admin-editor">
    <div className="panel-heading"><h2>{GAMES[issue.game].name} · 확인 항목</h2><span>{review ? review.status === 'resolved' ? '처리 완료' : '제외' : '미처리'}</span></div>
    <div className="admin-detail"><h3>{issue.title}</h3><p>{issue.reason}</p>
      <a className="source-link" href={issue.sourceUrl} target="_blank" rel="noreferrer">원문 확인 ↗</a>
      {issue.excerpt && <details><summary>수집한 본문 · 사유</summary><p className="admin-excerpt">{issue.excerpt}</p></details>}
      {review && <p className="admin-help">처리 기록: {koreanDate(review.updatedAt)}{review.note ? ` · ${review.note}` : ''}</p>}
      <label className="admin-note">처리 메모<textarea rows={3} value={note} maxLength={3000} onChange={(change) => setNote(change.target.value)} placeholder="원문 확인 결과·제외 이유" /></label>
      <div className="admin-actions"><button type="button" className="small-button" disabled={isBusy} onClick={onEdit}>{issue.eventId ? '일정 보정' : '이 공지에서 일정 추가'}</button>
        <button type="button" className="small-button" disabled={isBusy} onClick={() => void onSave({ action: 'review', id: issue.id, status: 'resolved', note })}>처리 완료</button>
        <button type="button" className="small-button" disabled={isBusy} onClick={() => void onSave({ action: 'review', id: issue.id, status: 'ignored', note })}>제외</button>
        {review && <button type="button" className="small-button" disabled={isBusy} onClick={() => void onSave({ action: 'review', id: issue.id, status: 'pending', note })}>미처리로 되돌리기</button>}</div>
      <p className="admin-help">처리 완료·제외는 확인 기록입니다. 캘린더의 기간·제목을 변경하려면 일정을 저장하세요.</p>
    </div>
  </section>;
};
