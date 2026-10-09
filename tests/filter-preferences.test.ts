import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GAME_IDS, EVENT_KINDS } from '../shared/calendar';
import { restoreFilterPreferences } from '../src/features/calendar/utils/filterPreferences';

test('게임과 분류 선택 복원 및 전체 해제 유지', () => {
  assert.deepEqual(restoreFilterPreferences({ games: ['wuwa'], kinds: ['banner'] }), { games: ['wuwa'], kinds: ['banner'] });
  assert.deepEqual(restoreFilterPreferences({ games: [], kinds: [] }), { games: [], kinds: [] });
});

test('저장된 데이터의 잘못된 식별자와 중복 제외 및 누락 필드 기본값', () => {
  assert.deepEqual(restoreFilterPreferences({ games: ['genshin', 'invalid', 'genshin', 1], kinds: ['event', null] }), { games: ['genshin'], kinds: ['event'] });
  assert.deepEqual(restoreFilterPreferences(null), { games: [...GAME_IDS], kinds: [...EVENT_KINDS] });
  assert.deepEqual(restoreFilterPreferences({ games: 'wuwa' }), { games: [...GAME_IDS], kinds: [...EVENT_KINDS] });
});
