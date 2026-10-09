import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { GAME_IDS, EVENT_KINDS, isCalendarResponse } from '../../../../shared/calendar';
import type { CalendarResponse, EventKind, GameId } from '../types';
import { todayDay } from '../utils/calendar';
import { restoreFilterPreferences } from '../utils/filterPreferences';
import { apiUrl } from '../../../utils/api';

interface CalendarState {
  selectedDay: number; focusRevision: number;
  games: GameId[]; kinds: EventKind[]; query: string;
  data: CalendarResponse | null; isLoading: boolean; error: string | null;
  goToday: () => void;
  selectDay: (day: number) => void; toggleGame: (game: GameId) => void;
  toggleKind: (kind: EventKind) => void; setQuery: (query: string) => void;
  load: () => Promise<void>;
}
export const useCalendarStore = create<CalendarState>()(persist((set, get) => ({
  selectedDay: todayDay(), focusRevision: 0,
  games: [...GAME_IDS], kinds: [...EVENT_KINDS], query: '', data: null, isLoading: false, error: null,
  goToday: () => set({ selectedDay: todayDay(), focusRevision: get().focusRevision + 1 }),
  selectDay: (selectedDay) => set({ selectedDay }),
  toggleGame: (game) => set((state) => ({ games: state.games.includes(game) ? state.games.filter((id) => id !== game) : [...state.games, game] })),
  toggleKind: (kind) => set((state) => ({ kinds: state.kinds.includes(kind) ? state.kinds.filter((id) => id !== kind) : [...state.kinds, kind] })),
  setQuery: (query) => set({ query }),
  load: async () => {
    if (get().isLoading) return;
    set({ isLoading: true, error: null });
    try {
      const response = await fetch(apiUrl('/api/calendar'));
      if (!response.ok) throw new Error('Calendar request failed');
      const data: unknown = await response.json();
      if (!isCalendarResponse(data)) throw new Error('Invalid calendar response');
      set({ data });
    } catch { set({ error: '일정 서버 연결 실패. 다시 불러오기로 재시도할 수 있습니다.' }); }
    finally { set({ isLoading: false }); }
  },
}), {
  name: 'subculture-calendar-filters',
  version: 2,
  migrate: (saved) => {
    const filters = restoreFilterPreferences(saved);
    return { ...filters, games: filters.games.length === 4 ? filters.games.concat('endfield') : filters.games };
  },
  storage: createJSONStorage(() => ({
    getItem: (name) => {
      try { return localStorage.getItem(name); }
      catch { return null; }
    },
    setItem: (name, value) => {
      try { localStorage.setItem(name, value); }
      catch { console.warn('Calendar filters could not be saved in browser storage.'); }
    },
    removeItem: (name) => {
      try { localStorage.removeItem(name); }
      catch { console.warn('Calendar filters could not be removed from browser storage.'); }
    },
  })),
  partialize: ({ games, kinds }) => ({ games, kinds }),
  merge: (saved, current) => ({ ...current, ...restoreFilterPreferences(saved) }),
}));

export const useCalendar = () => {
  const state = useCalendarStore();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = setInterval(update, 30000);
    document.addEventListener('visibilitychange', update);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', update); };
  }, []);
  useEffect(() => { void state.load(); }, [state.load]);
  const selectedEvents = (state.data?.events ?? []).filter((event) => state.games.includes(event.game) && state.kinds.includes(event.kind));
  const events = selectedEvents.filter((event) => event.title.toLocaleLowerCase().includes(state.query.trim().toLocaleLowerCase()));
  return { ...state, events, selectedEvents, now };
};
