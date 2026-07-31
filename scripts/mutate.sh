#!/bin/bash
# Mutation spot-check: prove a test actually guards the code it claims to.
#
#   scripts/mutate.sh <file> <sed-pattern> <jest args...>
#   e.g. scripts/mutate.sh src/lib/planner/dayComposition.ts 's/banked +/banked -/' --selectProjects node dayComposition
#
# Applies the sed mutation, runs the named tests, reverts, and reports:
#   KILLED   — the suite caught the mutant (the test is real)
#   SURVIVED — the mutant passed the suite (the test is theater; fix it)
#
# Standard practice for any bug-fix regression test: re-introduce the bug with
# this script and watch the new test fail before trusting it. The 2026-07-30
# test audit (docs/audits/) found both of its real coverage holes this way.
set -u
f="$1"; pat="$2"; shift 2
backup="$(mktemp)"
cp "$f" "$backup"
sed -i '' "$pat" "$f"
if ! cmp -s "$f" "$backup"; then
  out=$(npx jest --silent "$@" 2>&1 | grep -E "^Tests:" | tail -1)
  if echo "$out" | grep -q "failed"; then echo "KILLED   ($out)"; else echo "SURVIVED ($out)"; fi
else
  echo "NO-OP (pattern did not apply)"
fi
cp "$backup" "$f"
rm -f "$backup"
