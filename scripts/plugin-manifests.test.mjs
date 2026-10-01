import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = 'maxim-ai';
const HARNESSES = ['.claude-plugin', '.cursor-plugin'];

function json(path) {
  return JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
}

test('every plugin manifest names the same kebab-case plugin and carries no version', () => {
  for (const harness of HARNESSES) {
    const manifest = json(`${harness}/plugin.json`);
    assert.equal(manifest.name, PLUGIN, `${harness}/plugin.json`);
    assert.match(manifest.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    // No version: installs and updates follow the latest commit on the default branch.
    assert.equal(manifest.version, undefined, `${harness}/plugin.json must not set version`);
  }
});

test('every marketplace lists exactly the root plugin under the same name', () => {
  for (const harness of HARNESSES) {
    const marketplace = json(`${harness}/marketplace.json`);
    assert.equal(marketplace.name, PLUGIN, `${harness}/marketplace.json`);
    assert.ok(marketplace.owner?.name, `${harness}/marketplace.json needs owner.name`);
    assert.equal(marketplace.plugins.length, 1);
    const [entry] = marketplace.plugins;
    assert.equal(entry.name, PLUGIN);
    assert.equal(entry.source, './');
    assert.equal(entry.version, undefined, `${harness}/marketplace.json entry must not set version`);
  }
});

test('every skill folder holds a SKILL.md whose name matches the folder', () => {
  const skills = readdirSync(join(ROOT, 'skills'), { withFileTypes: true }).filter((entry) => entry.isDirectory());
  assert.ok(skills.length > 0);
  for (const { name } of skills) {
    const path = join(ROOT, 'skills', name, 'SKILL.md');
    assert.ok(existsSync(path), `skills/${name}/SKILL.md is missing`);
    assert.match(readFileSync(path, 'utf8'), new RegExp(`^---\\r?\\nname: ${name}\\r?\\n`), `skills/${name}/SKILL.md name`);
  }
});
