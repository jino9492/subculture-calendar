import { useEffect, useRef, useState } from 'react';
import { isNoticeList, type Notice } from '../../../../shared/notices';
import { apiUrl } from '../../../utils/api';
import { koreanDate } from '../utils';

export const NoticeManager = () => {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const pending = useRef(false);
  const request = async (publish = false) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(apiUrl('/api/admin/notices'), publish ? {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, content }),
      } : undefined);
      if (!response.ok) throw new Error('Notice request failed');
      const result: unknown = await response.json();
      if (!isNoticeList(result)) throw new Error('Invalid notices');
      setNotices(result); setLoaded(true);
      if (publish) { setTitle(''); setContent(''); setMessage('공지를 등록했습니다. 사용자에게 표시됩니다.'); }
    } catch { setError(publish ? '공지 등록에 실패했습니다. 서버 연결과 입력 내용을 확인해 주세요.' : '공지를 불러오지 못했습니다. 다시 시도해 주세요.'); }
    finally { pending.current = false; setBusy(false); }
  };
  useEffect(() => { void request(); }, []);
  return <section aria-label="공지 관리">
    {error && <p className="notice error-notice" role="alert">{error}</p>}
    {message && <p className="notice" role="status">{message}</p>}
    <div className="admin-workspace">
      <section className="admin-editor"><div className="panel-heading"><h2>공지 작성</h2></div>
        <p className="admin-help">등록 즉시 공개됩니다. 사용자가 닫은 공지는 같은 브라우저에서 다시 표시되지 않습니다.</p>
        <form className="admin-form" onSubmit={(event) => { event.preventDefault(); void request(true); }}>
          <label>제목<input required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} disabled={busy} /></label>
          <label>내용<textarea required maxLength={10000} rows={12} value={content} onChange={(event) => setContent(event.target.value)} disabled={busy} /></label>
          <div className="admin-actions"><button className="small-button" type="submit" disabled={busy || !title.trim() || !content.trim()}>{busy ? '처리 중…' : '공지 등록'}</button></div>
        </form>
      </section>
      <section className="admin-editor"><div className="panel-heading"><h2>등록된 공지 {notices.length}개</h2>
        <button type="button" className="small-button" disabled={busy} onClick={() => void request()}>새로고침</button></div>
        {busy && !loaded && <p className="admin-help" role="status">공지를 불러오는 중…</p>}
        {loaded && !notices.length && <p className="admin-help">등록된 공지가 없습니다.</p>}
        <div className="admin-list">{notices.map((notice) => <article className="admin-detail notice-entry" key={notice.id}>
          <small>{koreanDate(notice.publishedAt)}</small><h3>{notice.title}</h3><p className="notice-content">{notice.content}</p>
        </article>)}</div>
      </section>
    </div>
  </section>;
};
