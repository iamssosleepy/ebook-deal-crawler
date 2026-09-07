import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readWorkflow = name => readFile(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8');

test('routes every production date to the permanent company desktop without laptop fallback', async () => {
  const workflow = await readWorkflow('daily.yml');
  assert.match(
    workflow,
    /runner_label=desktop/,
    'the permanent owner must be the Luzhou desktop'
  );
  assert.match(
    workflow,
    /runs-on:\s*\[self-hosted, linux, x64, ebook-deals, "\$\{\{ needs\.select-owner\.outputs\.runner_label \}\}"\]/,
    'production must use the explicit owner selector'
  );
  assert.match(
    workflow,
    /desktop:eric-desktop-wsl\)/,
    'the job must fail closed if GitHub assigns an unexpected physical runner'
  );
  assert.match(
    workflow,
    /timeout-minutes:\s*20/,
    'daily production must have a finite execution deadline'
  );
  assert.doesNotMatch(workflow, /runner_label=laptop|laptop:eric-laptop-wsl/);
  assert.match(workflow, /group: ebook-deals-production/);
  assert.match(workflow, /REQUIRE_ALL_SOURCES: '1'/);
});

test('keeps the Luzhou desktop workflow isolated', async () => {
  const workflow = await readWorkflow('desktop-dry-run.yml');
  assert.match(
    workflow,
    /runs-on:\s*\[self-hosted, linux, x64, ebook-deals, desktop\]/,
    'desktop acceptance must keep its dedicated desktop label'
  );
});
