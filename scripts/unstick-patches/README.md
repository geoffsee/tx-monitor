# CI unstick patches

Prefer `.github/unstick-patches/` (includes Weekly Deploy). These copies cover
auto-merge, outdated-PR rebase, and Auto Tag. Applied to live workflows on
2026-11-09.

```bash
cp scripts/unstick-patches/dependabot-auto-merge.yml .github/workflows/
cp scripts/unstick-patches/update-outdated-prs.yml .github/workflows/
cp scripts/unstick-patches/auto-tag.yml .github/workflows/
```

What they fix:

- auto-merge via `pull_request_target` + `RELEASE_TOKEN` so Dependabot merges
  trigger Auto Tag / Test on main (GITHUB_TOKEN merges do not)
- outdated-PR rebases comment as RELEASE_TOKEN (Dependabot rejects GITHUB_TOKEN)
- format package.json after `npm version` so Release lint stays green
