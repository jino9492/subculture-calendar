import { useEffect } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { CalendarEvent } from '../../../shared/calendar';
import { completedEventIds, mergeCompletionRecords, reconcileCompletionRecords, restoreCompletionRecords, toggleCompletion, type CompletionRecord } from './records';

const STORAGE_KEY = 'subculture-calendar-completions';
const useStorageStatus = create<{ error: string | null }>(() => ({ error: null }));
interface CompletionState {
  records: CompletionRecord[];
  toggle: (event: CalendarEvent, events: CalendarEvent[]) => void;
  synchronize: (saved: unknown) => void;
  reconcile: (events: CalendarEvent[]) => void;
}
const storageFailure = (error: unknown) => {
  console.warn('완료 기록을 브라우저에 저장하거나 불러오지 못했습니다.', error);
  useStorageStatus.setState({ error: '완료 기록 저장 실패. 현재 화면의 체크는 유지되지만 새로고침하면 사라질 수 있습니다.' });
};

export const useCompletionStore = create<CompletionState>()(persist((set, get) => ({
  records: [],
  toggle: (event, events) => {
    void useCompletionStore.persist.rehydrate();
    set({ records: toggleCompletion(get().records, event, events) });
  },
  synchronize: (saved) => {
    const incoming = mergeCompletionRecords([], restoreCompletionRecords(saved));
    const records = mergeCompletionRecords(get().records, incoming);
    if (JSON.stringify(records) !== JSON.stringify(get().records) || JSON.stringify(records) !== JSON.stringify(incoming)) set({ records });
  },
  reconcile: (events) => {
    const records = reconcileCompletionRecords(get().records, events);
    if (JSON.stringify(records) !== JSON.stringify(get().records)) set({ records });
  },
}), {
  name: STORAGE_KEY,
  version: 1,
  storage: createJSONStorage(() => ({
    getItem: (key) => { if (typeof window === 'undefined') return null; try { return localStorage.getItem(key); } catch (error) { storageFailure(error); return null; } },
    setItem: (key, value) => {
      try { localStorage.setItem(key, value); useStorageStatus.setState({ error: null }); }
      catch (error) { storageFailure(error); }
    },
    removeItem: (key) => { try { localStorage.removeItem(key); } catch (error) { storageFailure(error); } },
  })),
  partialize: ({ records }) => ({ records }),
  merge: (saved, current) => ({ ...current, records: mergeCompletionRecords(current.records, restoreCompletionRecords(saved)) }),
  onRehydrateStorage: () => (_state, error) => { if (error) storageFailure(error); },
}));

export const useCompletion = (events: CalendarEvent[]) => {
  const state = useCompletionStore();
  const storageError = useStorageStatus((status) => status.error);
  useEffect(() => { useCompletionStore.getState().reconcile(events); }, [events]);
  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      try {
        if (event.storageArea !== localStorage || event.key !== STORAGE_KEY || !event.newValue) return;
        const saved: unknown = JSON.parse(event.newValue);
        if (typeof saved === 'object' && saved !== null && 'state' in saved) useCompletionStore.getState().synchronize(saved.state);
      } catch (error) { storageFailure(error); }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);
  const completed = completedEventIds(state.records, events);
  return { isCompleted: (event: CalendarEvent) => completed.has(event.id),
    toggle: (event: CalendarEvent) => state.toggle(event, events), storageError };
};
