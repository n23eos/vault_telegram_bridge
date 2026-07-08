#!/usr/bin/env node
/**
 * Copies the built plugin into an Obsidian vault.
 *
 *   node scripts/install-to-vault.mjs /path/to/vault
 *   OBSIDIAN_VAULT=/path/to/vault node scripts/install-to-vault.mjs
 *
 * Run `npm run build` first, or pass --build to have this do it.
 *
 * Refuses to write anywhere that does not already contain a `.obsidian`
 * directory: the config folder name is a per-vault setting, but its absence at
 * the default location almost always means the path is wrong, and the failure
 * mode of guessing is a plugin folder scattered into someone's home directory.
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(repoRoot, 'manifest.json'), 'utf8'));

const args = process.argv.slice(2);
const shouldBuild = args.includes('--build');
const vault = args.find((a) => !a.startsWith('--')) ?? process.env.OBSIDIAN_VAULT;

function die(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

if (!vault) {
  die('No vault path.\n  Usage: node scripts/install-to-vault.mjs /path/to/vault [--build]');
}

const vaultPath = resolve(vault);
if (!existsSync(vaultPath) || !statSync(vaultPath).isDirectory()) {
  die(`Not a directory: ${vaultPath}`);
}

const configDir = join(vaultPath, '.obsidian');
if (!existsSync(configDir)) {
  die(
    `No .obsidian directory in ${vaultPath}.\n` +
      `  That path is probably not a vault root. Open Obsidian → Settings → About → "Override config folder"\n` +
      `  if you deliberately renamed it, and copy the files by hand.`,
  );
}

if (shouldBuild) {
  console.log('Building…');
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
}

const built = join(repoRoot, 'main.js');
if (!existsSync(built)) {
  die('main.js is missing. Run `npm run build` first, or pass --build.');
}

const target = join(configDir, 'plugins', manifest.id);
mkdirSync(target, { recursive: true });

for (const file of ['main.js', 'manifest.json']) {
  copyFileSync(join(repoRoot, file), join(target, file));
  console.log(`  → ${join(target, file)}`);
}

// styles.css is optional and this plugin has none. Copy it if it ever appears.
if (existsSync(join(repoRoot, 'styles.css'))) {
  copyFileSync(join(repoRoot, 'styles.css'), join(target, 'styles.css'));
  console.log(`  → ${join(target, 'styles.css')}`);
}

console.log(
  `\n✔ ${manifest.name} ${manifest.version} installed (${statSync(built).size} bytes).\n` +
    `  Obsidian keeps the old main.js in memory until the plugin is reloaded.\n` +
    `  Settings → Community plugins → toggle "${manifest.name}" off and on.\n`,
);
