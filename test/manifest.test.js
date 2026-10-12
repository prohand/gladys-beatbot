// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ACTIONS } from '../src/capabilities/actions.js';
import { SCENE_ACTIONS } from '../src/capabilities/scenes.js';
import { SCENE_TRIGGER_KEYS } from '../src/capabilities/triggers.js';
import { FORM_ACTIONS, WIDGETS } from '../src/capabilities/widget.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import {
  ERROR_LABELS,
  PRODUCT_CATEGORY,
  SIMPLE_STATUSES,
  errorKeysFor,
} from '../src/beatbot/protocol.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);
const trigger = (key) => manifest.scene_triggers.find((t) => t.key === key);

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

test('the integration is a cloud device integration', () => {
  assert.equal(manifest.type, 'device');
  assert.deepEqual(manifest.transports, ['cloud'], 'Beatbot robots are reachable by cloud only');
});

test('every manifest action has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.actions).sort(), Object.keys(ACTIONS).sort());
});

test('catalog categories and capability fields require Gladys >= 5.1.0', () => {
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  for (const field of ['scene_triggers', 'scene_actions', 'widgets']) {
    assert.ok(manifest[field]?.length, `${field} declared`);
  }
  assert.ok(
    isAtLeast(minGladysVersion(), [5, 1, 0]),
    `got "${manifest.gladys_version}", 5.1.0 is the first release with the capability fields`,
  );
});

test('widget button forms require Gladys >= 5.2.0', () => {
  // An older core drops the `fields` of a widget action and relays the tap
  // without `values`: the form would silently do nothing.
  assert.ok(FORM_ACTIONS.length >= 1, 'the widget declares form actions');
  assert.ok(
    isAtLeast(minGladysVersion(), [5, 2, 0]),
    `got "${manifest.gladys_version}", 5.2.0 is the first release relaying widget action values`,
  );
});

test('every scene_actions key has an onSceneAction handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
  for (const action of manifest.scene_actions) {
    assert.deepEqual(keysOf(action.outputs), ['sent'], `${action.key} outputs`);
  }
});

test('every widgets key has a content handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.widgets).sort(), Object.keys(WIDGETS).sort());
  assert.ok(manifest.widgets.length <= 5);
});

test('every scene trigger the code fires is declared, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), [...SCENE_TRIGGER_KEYS].sort());
});

test('trigger filters offer exactly the values the code sends', () => {
  const status = trigger('status_changed').fields.find((f) => f.key === 'status');
  assert.deepEqual(
    status.options.map((o) => o.value),
    SIMPLE_STATUSES,
  );
  const error = trigger('error_raised').fields.find((f) => f.key === 'error');
  const faults = [
    ...errorKeysFor(PRODUCT_CATEGORY.POOL_CLEAN_BOT, { includeNotices: false }),
    ...errorKeysFor(PRODUCT_CATEGORY.CLEAN_BASE_STATION, { includeNotices: false }),
  ];
  assert.deepEqual(
    error.options.map((o) => o.value),
    faults,
  );
  for (const option of error.options) {
    assert.deepEqual(option.label, ERROR_LABELS[option.value]);
  }
});

test('scene trigger fields never use the boolean type', () => {
  for (const t of manifest.scene_triggers) {
    for (const field of t.fields ?? []) {
      assert.notEqual(field.type, 'boolean', `${t.key}.${field.key}`);
    }
  }
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  const withDefault = manifest.config_schema.filter((f) => f.default !== undefined);
  assert.deepEqual(Object.fromEntries(withDefault.map((f) => [f.key, f.default])), DEFAULT_CONFIG);
});

test('the account is linked through an oauth2 field, without default nor placeholder', () => {
  const oauth = manifest.config_schema.filter((f) => f.type === 'oauth2');
  assert.equal(oauth.length, 1);
  assert.equal(oauth[0].default, undefined);
  assert.equal(oauth[0].placeholder, undefined);
});

test('section fields are purely presentational', () => {
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.equal(section.placeholder, undefined);
    assert.ok(!(section.key in DEFAULT_CONFIG));
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('dynamic selects declare a source and no static options', () => {
  for (const field of allFields.filter((f) => f.source !== undefined)) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined, field.key);
  }
});

test('keys follow the store pattern', () => {
  const keys = [
    ...allFields.map((f) => f.key),
    ...keysOf(manifest.actions),
    ...keysOf(manifest.scene_triggers),
    ...keysOf(manifest.scene_actions),
    ...keysOf(manifest.widgets),
  ];
  for (const key of keys) {
    assert.match(key, /^[a-z0-9_]+$/, key);
  }
});

test('every text is a multi-language object with English and French', () => {
  const texts = [];
  const walk = (node, path) => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}[${i}]`));
    } else if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (['label', 'description', 'placeholder'].includes(key)) {
          texts.push([`${path}.${key}`, value]);
        } else {
          walk(value, `${path}.${key}`);
        }
      }
    }
  };
  walk(manifest, 'manifest');
  assert.ok(texts.length > 20);
  for (const [path, value] of texts) {
    assert.equal(typeof value, 'object', path);
    assert.ok(value.en && value.fr, `${path} needs en and fr`);
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.equal(manifest.docker_image, `ghcr.io/prohand/gladys-beatbot:${manifest.version}`);
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
});
