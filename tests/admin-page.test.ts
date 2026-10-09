import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdminPage } from '../src/features/admin/components/AdminPage';

test('접근 확인 전에는 관리 화면과 조작 버튼을 표시하지 않음', () => {
  const markup = renderToStaticMarkup(createElement(AdminPage));
  assert.match(markup, /관리자 접근을 확인하는 중/);
  for (const text of ['수집 관리', '원본 재수집', '일정 추가', '확인 항목', '수집 로그']) {
    assert.ok(!markup.includes(text));
  }
  assert.ok(!markup.includes('<button'));
});
