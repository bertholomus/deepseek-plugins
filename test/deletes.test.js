import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { deletesOf, codeDeletesOf, deletesWhat, isFree } from '../plugins/projects/lib/deletes.js';

// What a project thread's command deletes (plugins/projects/lib/deletes.js): the plugin asks the user before one that
// deletes files the thread didn't create. Scripts the thread created are read through `read`, here from this table.
const files = {
  '/w/tidy.sh': '#!/bin/sh\nrm -rf build\n',
  '/w/gen.py': "import shutil\nshutil.rmtree('out')\n",
  '/w/cleanup.sh': '#!/bin/sh\necho done\n',
};
const at = { cwd: '/w', read: (path) => files[path] };

const DELETES = [
  'rm -rf build/',
  'rm build/a.o build/b.o',
  'rmdir build',
  'unlink build/a.o',
  'shred -u secrets.txt',
  'git clean -fdx',
  'git clean -f -- build',
  'git rm old.txt',
  "find . -name '*.o' -delete",
  'find build -type f -exec rm {} \\;',
  'find . -name "*.tmp" | xargs rm -f',
  'npx rimraf dist',
  'sudo rm -rf /var/www/old',
  'env X=1 timeout 5 nice -n 5 rm -rf build',
  '/bin/rm -rf build',
  "'r''m' -rf build",
  'r\\m -rf build',
  "bash -c 'rm -rf build'",
  'sh -lc "cd /w && rm -rf build"',
  'eval "rm -rf build"',
  "bash <<'EOF'\nrm -rf build\nEOF",
  'cat <<EOF | sh\nrm -rf build\nEOF',
  'echo "rm -rf build" | bash',
  'echo "$(rm -rf build)"',
  "python3 -c \"import shutil; shutil.rmtree('build')\"",
  "python3 - <<'EOF'\nimport os\nos.remove('a.txt')\nEOF",
  "node -e \"require('fs').rmSync('build', { recursive: true })\"",
  "node -e \"require('child_process').execSync('rm -rf build')\"",
  'pwsh -Command "Remove-Item -Recurse build"',
  'sh tidy.sh',
  'python3 gen.py',
  'npm run clean',
  'yarn clean:all',
  'make distclean',
  './scripts/cleanup.sh',
];

const NO_DELETES = [
  'ls -la build',
  'echo rm -rf build',
  "printf 'rm -rf %s\\n' build",
  '# rm -rf build',
  'git clean -n',
  'git clean --dry-run -fd',
  'git rm --cached old.txt',
  'git status',
  'rm --help',
  'command -v rm',
  'cat build/a.o > /dev/null',
  'mv build build.old',
  'npm run build',
  'npm ci',
  'make',
  './build.sh',
  'python3 -m pytest',
  "python3 -c \"print('use os.remove to delete')\"",
  "grep -r 'shutil.rmtree' src",
  'sh cleanup.sh',
];

test('deletes: rm and the rest, through wrappers, quotes, here-documents, code and scripts', () => {
    for (const command of DELETES) assert.ok(deletesOf(command, at).length > 0, `a delete: ${command}`);
    assert.ok(deletesOf('Remove-Item -Recurse -Force build', { ...at, shell: 'pwsh' }).length > 0);
    assert.ok(deletesOf('rm build', { ...at, shell: 'pwsh' }).length > 0);
    assert.ok(deletesOf('$r = Remove-Item build', { ...at, shell: 'pwsh' }).length > 0);
});

test('deletes: commands that delete nothing', () => {
    for (const command of NO_DELETES) assert.deepEqual(deletesOf(command, at), [], `no delete: ${command}`);
    assert.deepEqual(deletesOf('Remove-Item build -WhatIf', { ...at, shell: 'pwsh' }), []);
    assert.deepEqual(deletesOf('./tidy.sh', { cwd: '/w' }), [], 'a script it may not read counts only by its name');
    assert.equal(deletesOf('./cleanup.sh', { cwd: '/w' }).length, 1, 'and that name can say it cleans');
});

test('deletes: what a delete says, after "the command"', () => {
    const said = (command) => deletesWhat(deletesOf(command, at));
    assert.equal(said('rm -rf build/'), 'deletes build/ (rm)');
    assert.equal(said('rm -rf build dist'), 'deletes build and dist (rm)');
    assert.equal(said('rm a b c d e'), 'deletes a, b and 3 more (rm)');
    assert.equal(said('git clean -fdx && rm -rf build'), 'deletes untracked and ignored files (git clean) and build (rm)');
    assert.equal(said("find . -name '*.o' -delete"), 'deletes what it finds in . (find -delete)');
    assert.equal(said('ls | xargs rm'), 'deletes the files named on its input (xargs rm)');
    assert.equal(said('sh tidy.sh'), 'runs tidy.sh, which deletes build (rm)');
    assert.equal(said('npm run clean'), 'runs npm run clean, whose name says it deletes files');
    assert.equal(said("python3 -c \"import shutil; shutil.rmtree('build')\""), 'runs code that deletes build (python3)');
    assert.equal(said("python3 -c \"import os; os.system('rm -rf build')\""), 'runs code that deletes build (rm)');
});

test('deletes: where each thing is, when that can be told', () => {
    const where = (command, options = at) => deletesOf(command, options).map((d) => (d.temp ? 'temp' : d.full ?? (d.glob !== undefined ? `glob ${d.glob}` : null)));
    assert.deepEqual(where('rm -rf build ../other /abs ~/x'), ['/w/build', '/other', '/abs', join(homedir(), 'x')]);
    assert.deepEqual(where('cd sub && rm -rf build'), ['/w/sub/build']);
    assert.deepEqual(where('cd "$DIR" && rm -rf build'), [null]);
    assert.deepEqual(where('rm -rf $DIR "$HOME/x" build/*.o'), [null, null, 'glob /w/build/']);
    assert.deepEqual(where('d=$(mktemp -d) && rm -rf "$d" "$d/sub"'), ['temp', 'temp']);
    assert.deepEqual(where('rm -f "$(mktemp)"; cd "$(mktemp -d)" && rm -rf x'), ['temp', 'temp']);
    assert.deepEqual(where('git -C sub clean -fd'), ['/w/sub']);
    assert.deepEqual(where('find /tmp/x -delete'), ['/tmp/x']);
    assert.deepEqual(where('rm -rf build', { cwd: undefined }), [null]);
});

test('deletes: free are the files the thread created, a folder of only those, the temp folder outside the workspace and mktemp\'s; never .git', () => {
    const work = mkdtempSync(join(tmpdir(), 'deletes-work-'));
    mkdirSync(join(work, 'build'));
    writeFileSync(join(work, 'build', 'a.o'), 'x');
    mkdirSync(join(work, 'scratch'));
    writeFileSync(join(work, 'scratch', 'n.txt'), 'x');
    writeFileSync(join(work, 'mine.txt'), 'x');
    mkdirSync(join(work, 'empty'));
    const created = new Set([join(work, 'mine.txt'), join(work, 'scratch', 'n.txt')]);
    const free = (command) => deletesOf(command, { cwd: work }).every((d) => isFree(d, { work: [work], created }));
    for (const command of ['rm mine.txt', 'rm -rf scratch', 'rm scratch/*.txt', 'rm -rf gone/', 'rm -rf /tmp/x', 'd=$(mktemp -d) && rm -rf "$d"', 'rm -f /tmp/foo-*']) assert.ok(free(command), command);
    for (const command of ['rm -rf build', 'rm -rf .', 'rmdir empty', 'rm -f .git/index.lock', 'rm -rf build/*.o', 'rm -rf /tmp/*', 'rm -rf "$X"', `rm -rf ${work}`, 'git clean -fd', 'ls | xargs rm']) assert.ok(!free(command), command);
    // The temp folder doesn't make a workspace inside it free, nor a folder that holds one.
    assert.equal(isFree({ program: 'rm', path: 'x', full: join(work, 'build') }, { work: [work] }), false);
    assert.equal(isFree({ program: 'rm', path: 'x', full: '/tmp' }, { work: ['/w'] }), false);
});

test('deletes: code deletes by its calls; its strings count as commands only where it runs commands', () => {
    const paths = (code) => codeDeletesOf(code, { cwd: '/w' }).map((d) => d.full ?? d.path);
    assert.deepEqual(paths("import os\nos.remove('a.txt')"), ['/w/a.txt']);
    assert.deepEqual(paths("from pathlib import Path\nPath('/w/b.txt').unlink()"), ['/w/b.txt']);
    assert.deepEqual(paths('shutil.rmtree(folder)'), ['a path the code works out']);
    assert.deepEqual(paths("await fs.promises.rm('dist', { recursive: true })"), ['/w/dist']);
    assert.deepEqual(paths("import { rm } from 'node:fs/promises'\nawait rm('dist', { recursive: true })"), ['/w/dist']);
    assert.deepEqual(paths("subprocess.run(['rm', '-rf', 'build'])"), ['/w/build']);
    assert.deepEqual(paths("FileUtils.rm_rf('tmp/cache')"), ['/w/tmp/cache']);
    assert.deepEqual(paths("console.log('rm -rf build')"), []);
    assert.deepEqual(paths("print('call os.remove on it')"), []);
});
