import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRecord } from '../shared/calendar';
import { isNoticeInput, isNoticeList, type Notice, type NoticeInput } from '../shared/notices';

export const createNoticeStore = (url = new URL('../data/notices.json', import.meta.url)) => {
  let writes: Promise<void> = Promise.resolve();
  const read = async (): Promise<Notice[]> => {
    try {
      const value: unknown = JSON.parse(await readFile(url, 'utf8'));
      if (!isNoticeList(value)) throw new Error('Invalid notice store');
      return value;
    } catch (error) {
      if (isRecord(error) && error.code === 'ENOENT') return [];
      throw error;
    }
  };
  const publish = (input: NoticeInput): Promise<void> => {
    const operation = writes.then(async () => {
      if (!isNoticeInput(input)) throw new Error('Invalid notice');
      const notices = await read();
      notices.unshift({ id: randomUUID(), title: input.title.trim(), content: input.content.trim(), publishedAt: new Date().toISOString() });
      await mkdir(dirname(fileURLToPath(url)), { recursive: true });
      const temporary = new URL(`${url.href}.tmp`);
      await writeFile(temporary, JSON.stringify(notices, null, 2));
      await rename(temporary, url);
    });
    writes = operation.catch((error: unknown) => { console.error('Notice store write failed', error); });
    return operation;
  };
  return { read, publish };
};
export const noticeStore = createNoticeStore();
