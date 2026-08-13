#!/usr/bin/env node
// PreToolUse(Bash | mcp__*github*) — enforce the repository's merge policy.
// CodBoard's autoMergeMode of the repository being merged is the source of
// truth (cached from post-codboard).
//
// Both merge paths are guarded. Watching only `gh pr merge` left the plugin's
// single hard `deny` unreachable from a Claude Code web session, where merges
// go through the GitHub MCP server and the CLI does not exist. Every other
// command and tool passes through untouched.
import {
  readStdin,
  readConfig,
  readState,
  remoteUrl,
  normalizeRepoUrl,
  MERGE_COMMAND_RE,
  MERGE_TOOLS,
  emit,
} from './lib.mjs';

function decide(decision, reason) {
  emit({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  });
}

function toolSuffix(toolName) {
  const parts = String(toolName || '').split('__');
  return parts[parts.length - 1] || '';
}

// Which repository is about to be merged. An MCP call names it outright, which
// is more precise than the working directory; a Bash merge is answered by the
// remote of the directory it runs in.
function targetRepoUrl(input) {
  const suffix = toolSuffix(input.tool_name);
  if (MERGE_TOOLS.has(suffix)) {
    const { owner, repo } = input.tool_input || {};
    return owner && repo ? `https://github.com/${owner}/${repo}` : undefined;
  }
  return remoteUrl(input);
}

function isMerge(input) {
  if (MERGE_TOOLS.has(toolSuffix(input.tool_name))) return true;
  const command = (input.tool_input && input.tool_input.command) || '';
  return MERGE_COMMAND_RE.test(command);
}

function main() {
  const input = readStdin();
  if (!readConfig(input)) emit(undefined); // not a CodBoard repo
  if (!isMerge(input)) emit(undefined); // not a merge

  const state = readState(input);
  // The policy belongs to the repository being merged (ADR 0069), so match the
  // one this call actually targets rather than answering for the whole project.
  const url = targetRepoUrl(input);
  const mode = url ? (state.mergeModes || {})[normalizeRepoUrl(url)] : undefined;

  if (mode === 'none') {
    decide(
      'deny',
      "CodBoard autoMergeMode is 'none' for this repository: the owner merges. Do " +
        'not merge without explicit owner approval — ask the owner to perform or ' +
        'request the merge.',
    );
  }

  if (!mode) {
    decide(
      'ask',
      'CodBoard tracks this repo but its merge policy has not been read this ' +
        'session. Call `list_repositories` and check the `automation.autoMergeMode` ' +
        'of this repository (and satisfy its CI evidence) before merging. Proceed anyway?',
    );
  }

  // ci_green / local_ci_green / without_ci: a configured non-none mode IS the
  // standing authorization to merge. Let it through with NO confirmation prompt
  // (never return 'ask' here) — the codboard-watch skill governs the CI evidence
  // and mandates merging without re-asking once it holds.
  emit(undefined);
}

try {
  main();
} catch {
  process.exit(0);
}
