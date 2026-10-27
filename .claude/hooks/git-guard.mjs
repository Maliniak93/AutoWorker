#!/usr/bin/env node
// Usage: PreToolUse hook (Bash) - asks before git/gh commands that leave the feat|fix|chore lane or aim at the default branch; denies a force-push to it

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

let TRUNK_NAME = "main";
try {
  ({ DEFAULT_BRANCH: TRUNK_NAME } = await import("../../scripts/config.mjs"));
} catch {
  TRUNK_NAME = "main";
}

const LANE = /^(feat|chore|fix)\//;
const isTrunk = (ref) => ref === TRUNK_NAME;

function isLane(branch) {
  return !!branch && LANE.test(branch);
}

const ASK = "ask";
const DENY = "deny";

function main() {
  const payload = readPayload();
  if (!payload || payload.tool_name !== "Bash") return;

  const command = payload.tool_input?.command;
  if (typeof command !== "string" || !command.trim()) return;

  const verdict = decide(command, payload.cwd || process.cwd());
  if (!verdict) return;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: verdict.decision,
        permissionDecisionReason: verdict.reason,
      },
    }),
  );
}

function readPayload() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}

function decide(command, cwd) {
  let worst = null;

  for (const segment of splitSegments(command)) {
    const verdict = judge(segment, cwd);
    if (!verdict) continue;
    if (!worst || verdict.decision === DENY) worst = verdict;
  }

  return worst;
}

// Quoted text stays intact, so a commit message containing `;` or `&&` cannot manufacture a segment.
function splitSegments(command) {
  const segments = [];
  let current = "";
  let quote = null;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];

    if (quote) {
      current += ch;
      if (ch === quote && command[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ";" || ch === "\n" || ch === "|" || ch === "&") {
      segments.push(current);
      current = "";
      if (command[i + 1] === ch) i++;
      continue;
    }
    current += ch;
  }
  segments.push(current);

  return segments.map((s) => s.trim()).filter(Boolean);
}

function tokenize(segment) {
  const tokens = segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  return tokens.map((t) =>
    (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))
      ? t.slice(1, -1)
      : t,
  );
}

function judge(segment, cwd) {
  const [bin, ...rest] = tokenize(segment);
  if (!rest.length) return null;
  if (bin === "git") return judgeGit(rest, cwd, segment);
  if (bin === "gh") return judgeGh(rest, cwd);
  return null;
}

function judgeGit(args, cwd, segment) {
  const sub = args.find((a) => !a.startsWith("-"));

  if (sub === "commit" || sub === "merge") return outsideLane(cwd, `\`git ${sub}\``);

  if (sub === "push") {
    const forced = args.some(
      (a) => a === "--force" || a === "-f" || a.startsWith("--force-with-lease"),
    );
    const trunkRef = args
      .filter((a) => !a.startsWith("-") && a !== "push")
      .some((ref) => isTrunk((ref.includes(":") ? ref.split(":").pop() : ref).replace(/^\+/, "")));

    if (trunkRef) {
      return forced
        ? {
            decision: DENY,
            reason: `Force-pushing ${TRUNK_NAME} is never part of this workflow: ${segment}`,
          }
        : {
            decision: ASK,
            reason: `Pushing to ${TRUNK_NAME} is a human decision, not an automated step.`,
          };
    }
    return outsideLane(cwd, "`git push`");
  }

  return null;
}

function judgeGh(args, cwd) {
  if (args[0] !== "pr") return null;

  if (args[1] === "create") {
    const i = args.indexOf("--base");
    const base = i === -1 ? null : args[i + 1];
    const branch = currentBranch(cwd);

    if (!base) {
      return {
        decision: ASK,
        reason: "PR has no explicit --base; it would default to the repository's default branch.",
      };
    }
    if (isTrunk(base) && isLane(branch)) return null;

    return {
      decision: ASK,
      reason: isTrunk(base)
        ? `\`gh pr create --base ${base}\` from \`${branch ?? "an indeterminate branch"}\`, which is not a lane branch (feat/*, chore/*, fix/*).`
        : `PR would target \`${base}\`, not ${TRUNK_NAME}.`,
    };
  }

  if (args[1] === "merge") {
    return { decision: ASK, reason: "Merging is the user's decision" };
  }

  return null;
}

function outsideLane(cwd, what) {
  const branch = currentBranch(cwd);

  if (!branch) return { decision: ASK, reason: `Could not determine the current branch for ${what}.` };
  if (isLane(branch)) return null;

  return {
    decision: ASK,
    reason: `${what} on \`${branch}\`, outside every working lane (feat/*, chore/*, fix/*).`,
  };
}

function currentBranch(cwd) {
  const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  return branch === "HEAD" ? null : branch;
}

function run(bin, args, cwd) {
  try {
    return execFileSync(bin, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 15_000,
      windowsHide: true,
    }).trim();
  } catch {
    return null;
  }
}

main();
