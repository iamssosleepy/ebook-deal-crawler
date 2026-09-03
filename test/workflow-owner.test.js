import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readWorkflow = name => readFile(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8');

test('pins the production workflow to the laptop owner', async () => {
  const workflow = await readWorkflow('daily.yml');
  assert.match(
    workflow,
    /runs-on:\s*\[self-hosted, linux, x64, ebook-deals, laptop\]/,
    'daily production must not be eligible for the Luzhou desktop before Gate-0 cutover'
  );
  assert.match(
    workflow,
    /timeout-minutes:\s*20/,
    'daily production must have a finite execution deadline'
  );
});

test('keeps the Luzhou desktop workflow isolated', async () => {
  const workflow = await readWorkflow('desktop-dry-run.yml');
  assert.match(
    workflow,
    /runs-on:\s*\[self-hosted, linux, x64, ebook-deals, desktop\]/,
    'desktop acceptance must keep its dedicated desktop label'
  );
});
