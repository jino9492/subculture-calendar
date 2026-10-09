import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayNumber, timelineTimePosition } from '../src/features/calendar/utils/calendar';

const first = dayNumber('2026-10-10T00:00:00+09:00');
const positionAt = (iso: string) => timelineTimePosition(Date.parse(iso), first, first + 2);

test('한국 시각 기준으로 오늘 칸을 24등분하고 정각에 한 칸 이동', () => {
  for (let hour = 0; hour < 24; hour++) {
    const time = `2026-10-10T${String(hour).padStart(2, '0')}`;
    const expected = { day: first, hour, position: hour / 24 };
    assert.deepEqual(positionAt(`${time}:00:00+09:00`), expected);
    assert.deepEqual(positionAt(`${time}:59:59.999+09:00`), expected);
  }
  assert.deepEqual(positionAt('2026-10-10T03:00:00Z'), { day: first, hour: 12, position: 0.5 });
});

test('자정에는 다음 날짜 시작으로 이동하고 오늘이 표시 범위 밖이면 숨김', () => {
  assert.deepEqual(positionAt('2026-10-11T00:00:00+09:00'), { day: first + 1, hour: 0, position: 1 });
  assert.deepEqual(positionAt('2026-10-12T23:00:00+09:00'), { day: first + 2, hour: 23, position: 2 + 23 / 24 });
  assert.equal(positionAt('2026-10-09T23:59:59+09:00'), null);
  assert.equal(positionAt('2026-10-13T00:00:00+09:00'), null);
});
