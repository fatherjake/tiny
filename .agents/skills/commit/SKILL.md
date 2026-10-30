---
name: commit
description: Commit all outstanding changes as logically grouped commits, then push. Use when the user says "commit", "commit and push", or "commit all outstanding".
---

Do the whole job without asking, unless a step below says to stop. The user's request to commit is the go-ahead to push.

1. **Read the repo's git rule.** Check `AGENTS.md` for a Git section. It decides the branch, pull request, and commit message style. If it says to commit to `main`, do that. If it says nothing, use the current branch and push it.
2. **List everything outstanding.** Run `git status --short` and `git diff`. Include untracked files. Skip anything ignored.
3. **Stop on secrets.** If a file looks like a secret (`.env`, keys, tokens, `*.p8`), leave it out and mention it in the reply. Do not stage it.
4. **Group logically.** One commit per coherent change, such as one feature, one fix, one refactor, or one docs update. Keep generated files with the change that produced them. Split unrelated work even if it touches the same folder.
5. **Stage explicit paths** for each commit with `git add <path> ...`. Never `git add -A` or `git add .`. When one file holds changes for two groups, use `git add -p`.
6. **Commit** with the message style from `AGENTS.md`. Default is `<type>(<target>): <subject>`, such as `fix(web): handle empty cart`. Subject in the imperative, under 72 characters, with a short body only when the why is not obvious. Respect hooks. If a hook fails, fix the cause and make a new commit. Never use `--no-verify`.
7. **Push** to the branch the repo rule names, usually `git push origin main`. If the push is rejected, run `git pull --rebase`, resolve it, and push again. Never force-push.
8. **Confirm** with `git status` that the tree is clean and nothing unpushed is left.

**Reply:** the commits as `hash subject`, the branch pushed, and anything left out and why.
