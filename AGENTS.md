# Agent Instructions

## Before Starting Any Work
1. Run `./init.sh` to verify environment health
2. Read `progress.md` for context from last session
3. Read `feature_list.json` to see what's done and what's next
4. Check `git log --oneline -10` for recent changes

## Rules
- Work on exactly ONE feature at a time
- Never declare "done" without passing tests
- Run the full test suite before committing
- Update `progress.md` after every session
- Update `feature_list.json` when a feature status changes
- At the end of session, remove 'release/win-unpacked' then rerun 'npm run package'
- Commit only when the project is in a clean, resumable state

## Verification Checklist
- [ ] Build and Package run properly
- [ ] All tests pass
- [ ] Linter passes
- [ ] Type-check passes
- [ ] Feature works as specified
