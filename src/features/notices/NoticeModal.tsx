import { useEffect, useRef, useState } from 'react';
import { isNoticeList, type Notice } from '../../../shared/notices';
import { apiUrl } from '../../utils/api';
import { markNoticesRead, NOTICE_READ_KEY, parseReadNotices, unreadNotices } from './records';

interface NoticeDialogProps { notices: Notice[]; onClose: () => void }
const NoticeDialog = ({ notices, onClose }: NoticeDialogProps) => {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="event-dialog notice-dialog" aria-labelledby="notices-heading"
    onCancel={(event) => { event.preventDefault(); onClose(); }} onClose={onClose}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="dialog-header"><h2 id="notices-heading">새 공지 <span>{notices.length}개</span></h2>
      <button type="button" className="icon-button" aria-label="공지 닫기" onClick={onClose} autoFocus>×</button></div>
    <div className="notice-entries">{notices.map((notice) => <article key={notice.id} className="notice-entry">
      <h3>{notice.title}</h3><time dateTime={notice.publishedAt}>{new Date(notice.publishedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</time>
      <p className="notice-content">{notice.content}</p>
    </article>)}</div>
    <div className="notice-dialog-footer"><span>닫으면 모든 공지가 확인 처리됩니다.</span>
      <button type="button" className="small-button" onClick={onClose}>모두 확인하고 닫기</button></div>
  </dialog>;
};

export const NoticeModal = () => {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [readIds, setReadIds] = useState<string[]>(() => {
    try { return parseReadNotices(localStorage.getItem(NOTICE_READ_KEY)); } catch { return []; }
  });
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let loading = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const response = await fetch(apiUrl('/api/notices'), { signal: controller.signal });
        if (!response.ok) return;
        const result: unknown = await response.json();
        if (!controller.signal.aborted && isNoticeList(result)) setNotices(result);
      } catch { /* Retry on the next visit or window focus; calendar access remains available. */ }
      finally { loading = false; }
    };
    const sync = (event: StorageEvent) => {
      if (event.key === NOTICE_READ_KEY || event.key === null) setReadIds(parseReadNotices(event.newValue));
    };
    void load();
    window.addEventListener('focus', load);
    window.addEventListener('storage', sync);
    return () => { controller.abort(); window.removeEventListener('focus', load); window.removeEventListener('storage', sync); };
  }, []);
  const unread = unreadNotices(notices, readIds);
  const close = () => {
    if (!unread.length) return;
    let next = markNoticesRead(JSON.stringify(readIds), unread);
    try {
      next = [...new Set([...parseReadNotices(localStorage.getItem(NOTICE_READ_KEY)), ...next])];
      localStorage.setItem(NOTICE_READ_KEY, JSON.stringify(next));
      setStorageError(false);
    } catch { setStorageError(true); }
    setReadIds(next);
  };
  return <>{storageError && <p className="notice error-notice" role="alert">공지 확인 기록을 브라우저에 저장하지 못했습니다. 새로고침하면 다시 표시될 수 있습니다.</p>}
    {unread.length > 0 && <NoticeDialog notices={unread} onClose={close} />}</>;
};
