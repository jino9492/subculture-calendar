import { useEffect } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { PlannerOptions } from '../types';
import { DEFAULT_OPTIONS, restorePlannerPreferences } from '../options';

const useStorageStatus = create<{ error: string | null }>(() => ({ error: null }));
const storageError = (error: unknown) => {
  console.warn('추천 설정을 저장하거나 불러오지 못했습니다.', error);
  useStorageStatus.setState({ error: '추천 설정 저장 실패. 현재 설정은 유지되지만 새로고침하면 사라질 수 있습니다.' });
};
interface PlannerState {
  options: PlannerOptions;
  setOptions: (value: Partial<PlannerOptions>) => void;
}
export const usePlannerStore = create<PlannerState>()(persist((set, get) => ({
  options: { ...DEFAULT_OPTIONS },
  setOptions: (value) => set({ options: restorePlannerPreferences({ options: { ...get().options, ...value } }).options }),
}), {
  name: 'subculture-calendar-planner', version: 2,
  migrate: (saved) => restorePlannerPreferences(saved),
  storage: createJSONStorage(() => ({
    getItem: (key) => { if (typeof window === 'undefined') return null; try { return localStorage.getItem(key); } catch (error) { storageError(error); return null; } },
    setItem: (key, value) => { try { localStorage.setItem(key, value); useStorageStatus.setState({ error: null }); } catch (error) { storageError(error); } },
    removeItem: (key) => { try { localStorage.removeItem(key); } catch (error) { storageError(error); } },
  })),
  partialize: ({ options }) => ({ options }),
  merge: (saved, current) => ({ ...current, ...restorePlannerPreferences(saved) }),
  onRehydrateStorage: () => (_state, error) => { if (error) storageError(error); },
}));
export const usePlanner = () => {
  const state = usePlannerStore();
  const error = useStorageStatus((value) => value.error);
  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      try {
        if (event.storageArea === localStorage && event.key === 'subculture-calendar-planner') void usePlannerStore.persist.rehydrate();
      } catch (error) { storageError(error); }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);
  return { ...state, error };
};
