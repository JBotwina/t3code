---
name: upstream-drift
description: Check how far this T2 Code fork has drifted behind its upstream parent repo (github.com/pingdotgg/t3code) — commits behind, notable missing changes, and likely merge conflicts. Use when the user asks what the fork is missing, how far behind upstream it is, to check upstream drift, or before a rebase/merge from upstream.
---

# Upstream drift check

Compare the fork against `pingdotgg/t3code` main. Prefer the GitHub API over
`git fetch upstream` — the fetch has been observed to time out on this network,
and the local `upstream/main` ref is often stale.

## Steps

1. **Find the branch point** (works even with a stale ref):

   ```sh
   git merge-base HEAD upstream/main
   ```

2. **Count commits behind and list them** via the API, not the stale ref:

   ```sh
   gh api 'repos/pingdotgg/t3code/compare/<merge-base>...main' \
     --jq '{behind_by: .ahead_by, latest: .commits[-1].commit.committer.date}'
   gh api 'repos/pingdotgg/t3code/commits?per_page=50&sha=main' \
     --jq '.[] | .sha[0:8] + " " + (.commit.message | split("\n")[0])'
   ```

   If `ahead_by` exceeds the commits listed, paginate or note the cap.

3. **Flag likely conflicts** — intersect files the fork touched with files
   upstream touched since the branch point:

   ```sh
   d=~/Desktop/tmp/upstream-drift && mkdir -p "$d"
   git diff --name-only <merge-base>..HEAD | sort > "$d/fork-files"
   gh api --paginate 'repos/pingdotgg/t3code/compare/<merge-base>...main' \
     --jq '.files[].filename' | sort -u > "$d/upstream-files"
   comm -12 "$d/fork-files" "$d/upstream-files"
   ```

   (The compare endpoint caps `.files` at 300; if upstream's diff is larger,
   say so and treat the overlap as a lower bound.)

## Report format

Keep it short:

- One line: N commits behind, upstream last active <date>.
- Bullets: the notable missing changes, grouped (features, release prep,
  fixes) — skip chores and vouches.
- Bullets: overlapping files = likely conflict spots on rebase. Note that the
  fork's branding call sites (`FORK_BRAND.*`, see FORK.md) are one-liners and
  usually merge clean.
