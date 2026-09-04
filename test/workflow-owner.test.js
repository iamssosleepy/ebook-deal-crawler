import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readWorkflow = name => readFile(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8');

test('routes only the approved 2026-09-05 and 2026-09-06 window to the desktop', async () => {
  const workflow = await readWorkflow('daily.yml');
  assert.match(
    workflow,
    /2026-09-05\|2026-09-06[\s\S]*runner_label=desktop[\s\S]*\*\)[\s\S]*runner_label=laptop/,
    'only the two explicitly approved weekend dates may select the Luzhou desktop'
  );
  assert.match(
    workflow,
    /runs-on:\s*\[self-hosted, linux, x64, ebook-deals, "\$\{\{ needs\.select-owner\.outputs\.runner_label \}\}"\]/,
    'production must use the date-bounded owner selector'
  );
  assert.match(
    workflow,
    /desktop:eric-desktop-wsl\|laptop:eric-laptop-wsl/,
    'the job must fail closed if GitHub assigns an unexpected physical runner'
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
