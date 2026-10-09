import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preserveTimelineScroll } from '../src/features/calendar/utils/calendar';

test('범위 시작일이 변해도 같은 날짜의 가로 위치 유지', () => {
  assert.equal(preserveTimelineScroll(1000, 100, 105, 88, 5000), 560);
  assert.equal(preserveTimelineScroll(1000, 100, 95, 88, 5000), 1440);
  assert.equal(preserveTimelineScroll(1000, 100, 100, 88, 5000), 1000);
});

test('보고 있던 날짜가 새 범위 밖이면 가장 가까운 경계로 제한', () => {
  assert.equal(preserveTimelineScroll(100, 100, 120, 88, 5000), 0);
  assert.equal(preserveTimelineScroll(4000, 100, 100, 88, 800), 800);
  assert.equal(preserveTimelineScroll(4000, 100, 100, 88, 0), 0);
});
