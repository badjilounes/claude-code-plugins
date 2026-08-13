// Exercises the CodBoard hooks against a throwaway git repo, replaying the
// session shapes that used to slip through.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HOOKS = dirname(fileURLToPath(import.meta.url));
let repo;
let failures = 0;
let checks = 0;

function sh(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function setup(branch, { tracked = true } = {}) {
  repo = mkdtempSync(join(tmpdir(), 'cb-'));
  sh('git', ['init', '-q', '-b', 'main'], repo);
  sh('git', ['config', 'user.email', 't@t.t'], repo);
  sh('git', ['config', 'user.name', 't'], repo);
  sh('git', ['remote', 'add', 'origin', 'git@github.com:badjilounes/playground-factory.git'], repo);
  writeFileSync(join(repo, 'f.txt'), 'x');
  sh('git', ['add', '.'], repo);
  sh('git', ['commit', '-qm', 'init'], repo);
  if (branch !== 'main') sh('git', ['checkout', '-qb', branch], repo);
  if (tracked) {
    mkdirSync(join(repo, '.codboard'));
    writeFileSync(join(repo, '.codboard', 'config.json'), JSON.stringify({ projectName: 'Sofia' }));
  }
}

function run(script, payload) {
  const out = execFileSync('node', [join(HOOKS, script)], {
    input: JSON.stringify({ session_id: 's1', cwd: repo, ...payload }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
    encoding: 'utf8',
  });
  return out ? JSON.parse(out) : undefined;
}

const bash = (command) => run('post-bash.mjs', { tool_name: 'Bash', tool_input: { command } });
const edit = () => run('post-work.mjs', { tool_name: 'Edit', tool_input: { file_path: 'f.txt' } });
const gh = (name, input, response) =>
  run('post-github.mjs', { tool_name: `mcp__github__${name}`, tool_input: input, tool_response: response });
const cb = (name, input, response) =>
  run('post-codboard.mjs', { tool_name: `mcp__codboard__${name}`, tool_input: input, tool_response: response });
const stop = () => run('stop-check.mjs', {});
const start = () => run('session-start.mjs', { source: 'startup' });
const guardBash = (command) => run('pre-merge-guard.mjs', { tool_name: 'Bash', tool_input: { command } });
const guardMcp = (name, input) => run('pre-merge-guard.mjs', { tool_name: `mcp__github__${name}`, tool_input: input });

function check(label, condition, detail) {
  checks += 1;
  if (condition) return console.log(`  ok   ${label}`);
  failures += 1;
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
}

const blocked = (r) => r && r.decision === 'block';
const reason = (r) => (r && r.reason) || '';
const decision = (r) => r && r.hookSpecificOutput && r.hookSpecificOutput.permissionDecision;
const state = () => JSON.parse(readFileSync(join(repo, '.codboard', 'session-state.json'), 'utf8'));

function scenario(name, fn) {
  console.log(`\n${name}`);
  try {
    fn();
  } catch (e) {
    failures += 1;
    console.log(`  FAIL threw — ${e.message}`);
  } finally {
    if (repo && existsSync(repo)) rmSync(repo, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------

scenario('REGRESSION: the pasted session (harness branch, edit, push, stop)', () => {
  setup('claude/calendar-recap-mobile-design-6cu6ms');
  start();
  check('branch captured at SessionStart', state().branch.name.startsWith('claude/'), JSON.stringify(state().branch));
  check('branch not mistaken for default', state().branch.isDefault === false);
  edit();
  bash('git commit -m "fix(web): mobile recap"');
  bash('git push -u origin claude/calendar-recap-mobile-design-6cu6ms');
  const r = stop();
  check('Stop BLOCKS', blocked(r), JSON.stringify(r));
  check('  cites the missing run', reason(r).includes('Existence'));
  check('  cites the unmirrored branch', reason(r).includes('never mirrored'));
});

scenario('branch creation forms', () => {
  const forms = [
    ['git checkout -b feat/a', 'feat/a'],
    ['git checkout -B feat/b origin/main', 'feat/b'],
    ['git switch -c feat/c', 'feat/c'],
    ['git switch -C feat/d', 'feat/d'],
    ['git switch --create feat/e', 'feat/e'],
    ['git branch feat/f', 'feat/f'],
    ['git push --set-upstream origin feat/g', 'feat/g'],
  ];
  for (const [cmd, expected] of forms) {
    setup('main');
    start();
    bash(cmd);
    const b = state().pending.branch;
    check(`${cmd}`, Boolean(b && b.seen && b.detail === expected), JSON.stringify(b));
    rmSync(repo, { recursive: true, force: true });
  }
  setup('main');
});

scenario('plain push on the default branch is not a milestone', () => {
  setup('main');
  start();
  bash('git push');
  check('no branch pending', !state().pending.branch, JSON.stringify(state().pending));
});

scenario('read-only session on a work branch does not block', () => {
  setup('claude/read-only');
  start();
  bash('npm test');
  bash('git status');
  const r = stop();
  check('Stop passes', !blocked(r), JSON.stringify(r));
});

scenario('GitHub MCP path: PR + writes are seen', () => {
  setup('claude/mcp');
  start();
  gh('push_files', { branch: 'claude/mcp' }, {});
  gh('create_pull_request', { owner: 'o', repo: 'r' }, { number: 673, html_url: 'https://x/673' });
  const r = stop();
  check('Stop BLOCKS', blocked(r));
  check('  PR recorded with its number', reason(r).includes('#673'), reason(r));
  check('  work recorded from push_files', reason(r).includes('Existence'));
});

scenario('mirroring clears the gates, in either order', () => {
  setup('claude/order');
  start();
  edit();
  bash('git push -u origin claude/order');
  cb('start_execution', {}, { executionId: 'e1' });
  cb('set_task_branch', { branch: 'claude/order' }, {});
  const r = stop();
  check('Stop passes once mirrored', !blocked(r), JSON.stringify(r));

  // codboard tool BEFORE the git command it covers
  setup('claude/order2');
  start();
  cb('set_task_branch', { branch: 'claude/order2' }, {});
  cb('start_execution', {}, { executionId: 'e1' });
  edit();
  bash('git push -u origin claude/order2');
  check('Stop passes when mirrored first', !blocked(stop()));
});

scenario('nested MCP payloads are parsed', () => {
  setup('main');
  start();
  cb('get_project', {}, { project: { reportingCadence: 'on_each_note', reportPrompt: 'x' } });
  check('projectRead set from {project:{...}}', state().projectRead === true);
  check('cadence read', state().policy.reportingCadence === 'on_each_note', JSON.stringify(state().policy));

  cb('list_repositories', {}, {
    repositories: [
      { url: 'https://github.com/badjilounes/playground-factory.git', automation: { autoMergeMode: 'local_ci_green' } },
    ],
  });
  const modes = state().mergeModes;
  check('mergeModes from {repositories:[...]}', modes['https://github.com/badjilounes/playground-factory'] === 'local_ci_green', JSON.stringify(modes));
});

scenario('unparsable get_project still arms the report gate', () => {
  setup('main');
  start();
  cb('get_project', {}, 'not json at all');
  check('projectRead set anyway', state().projectRead === true);
  check('cadence falls back strict', state().policy.reportingCadence === 'on_task_finished');
  cb('complete_execution', {}, {});
  const r = stop();
  check('report staleness blocks', blocked(r) && reason(r).includes('Report'), reason(r));
});

scenario('merge guard covers both paths', () => {
  setup('main');
  start();
  check('MCP merge, policy unread -> ask', decision(guardMcp('merge_pull_request', { owner: 'o', repo: 'r', pullNumber: 1 })) === 'ask');

  cb('list_repositories', {}, [
    { url: 'https://github.com/badjilounes/playground-factory', automation: { autoMergeMode: 'none' } },
    { url: 'https://github.com/o/r', automation: { autoMergeMode: 'ci_green' } },
  ]);
  check('MCP merge on ci_green repo -> allowed', guardMcp('merge_pull_request', { owner: 'o', repo: 'r', pullNumber: 1 }) === undefined);
  check('MCP auto-merge on none repo -> DENY', decision(guardMcp('enable_pr_auto_merge', { owner: 'badjilounes', repo: 'playground-factory', pullNumber: 1 })) === 'deny');
  check('Bash merge uses the cwd remote -> DENY', decision(guardBash('gh pr merge 1 --squash')) === 'deny');
  check('unrelated bash passes', guardBash('npm test') === undefined);
  check('unrelated github tool passes', guardMcp('get_file_contents', { owner: 'o', repo: 'r' }) === undefined);
});

scenario('untracked repo stays inert', () => {
  setup('claude/x', { tracked: false });
  check('post-bash silent', bash('git push -u origin claude/x') === undefined);
  check('post-work silent', edit() === undefined);
  check('stop silent', stop() === undefined);
  check('guard silent', guardMcp('merge_pull_request', { owner: 'o', repo: 'r' }) === undefined);
});

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
