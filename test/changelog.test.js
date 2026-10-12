// The Release workflow rolls CHANGELOG.md with this script: it must keep
// working, and the real changelog must stay rollable.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { rollChangelog } from '../.github/scripts/changelog-release.mjs';

const base = `# Changelog

## [Unreleased]

### Added

- Something new.

[Unreleased]: https://github.com/prohand/gladys-beatbot/commits/main
`;

test('the Unreleased section moves under the version, with its link', () => {
  const rolled = rollChangelog(base, '1.0.0', '2026-10-12');
  assert.match(
    rolled,
    /## \[Unreleased\]\n\n## \[1\.0\.0\] - 2026-10-12\n\n### Added\n\n- Something new\./,
  );
  assert.match(
    rolled,
    /\[Unreleased\]: https:\/\/github\.com\/prohand\/gladys-beatbot\/compare\/v1\.0\.0\.\.\.HEAD/,
  );
  assert.match(
    rolled,
    /\[1\.0\.0\]: https:\/\/github\.com\/prohand\/gladys-beatbot\/releases\/tag\/v1\.0\.0/,
  );
});

test('a second release compares with the previous tag', () => {
  const once = rollChangelog(base, '1.0.0', '2026-10-12');
  const twice = rollChangelog(
    once.replace('## [Unreleased]\n', '## [Unreleased]\n\n- Fix.\n'),
    '1.0.1',
    '2026-10-13',
  );
  assert.match(
    twice,
    /\[1\.0\.1\]: https:\/\/github\.com\/prohand\/gladys-beatbot\/compare\/v1\.0\.0\.\.\.v1\.0\.1/,
  );
});

test('a mention of the heading in the intro text is not the section', () => {
  const intro = base.replace(
    '# Changelog\n',
    '# Changelog\n\nDescribe each change under `## [Unreleased]` as you make it.\n',
  );
  const rolled = rollChangelog(intro, '1.0.0', '2026-10-12');
  assert.match(rolled, /under `## \[Unreleased\]` as you make it\./);
  assert.match(rolled, /## \[1\.0\.0\] - 2026-10-12\n\n### Added\n\n- Something new\./);
});

test('a version already in the changelog is not written twice', () => {
  const once = rollChangelog(base, '1.0.0', '2026-10-12');
  assert.equal(rollChangelog(once, '1.0.0', '2026-10-13'), once);
});

test('an empty Unreleased section still writes the version', () => {
  const empty = base.replace('### Added\n\n- Something new.\n', '');
  assert.match(rollChangelog(empty, '1.0.1', '2026-10-12'), /Maintenance release/);
});

test('the real CHANGELOG.md has an Unreleased section and its link', async () => {
  const text = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  assert.match(text, /^## \[Unreleased\]$/m);
  assert.match(text, /^\[Unreleased\]: https:\/\/github\.com\/prohand\/gladys-beatbot\//m);
});
