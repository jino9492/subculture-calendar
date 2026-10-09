import { useCallback, useEffect, useRef, useState } from 'react';
import { isAdminResponse, type AdminAction, type AdminResponse } from '../../../../shared/admin';

export const useAdmin = () => {
  const [data, setData] = useState<AdminResponse | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const busy = useRef(false);
  const request = useCallback(async (action?: AdminAction | 'refresh') => {
    if (busy.current) return false;
    busy.current = true;
    setIsBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(action === 'refresh' ? '/api/admin/refresh' : '/api/admin', action ? {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action === 'refresh' ? {} : action),
      } : undefined);
      if (!response.ok) throw new Error('Admin request failed');
      const result: unknown = await response.json();
      if (!isAdminResponse(result)) throw new Error('Invalid admin response');
      setData(result);
      if (action) setMessage(action === 'refresh' ? '재수집 완료. 게임별 수집 상태를 확인하세요.' : '저장했습니다. 캘린더에 반영됩니다.');
      return true;
    } catch {
      setError('관리 요청을 처리하지 못했습니다. 서버 연결과 입력 내용을 확인한 뒤 다시 시도해 주세요.');
      return false;
    } finally { busy.current = false; setIsBusy(false); }
  }, []);
  useEffect(() => { void request(); }, [request]);
  return { data, isBusy, error, message, request };
};
