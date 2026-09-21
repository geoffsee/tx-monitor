# Dependabot shipping unstick patches

Apply these over `.github/workflows/` with a token that has **Workflows** write
permission (`RELEASE_TOKEN` currently lacks it, which blocks Supervisor):

```bash
cp .github/unstick-patches/dependabot-auto-merge.yml .github/workflows/
cp .github/unstick-patches/update-outdated-prs.yml .github/workflows/
cp .github/unstick-patches/auto-tag.yml .github/workflows/
cp .github/unstick-patches/weekly-deploy.yml .github/workflows/
```

## Why
- Auto-merge via `GITHUB_TOKEN` merges as `github-actions` and skips push workflows (Auto Tag never ran for lockfile bumps like #82).
- Prefer `pull_request_target` + `RELEASE_TOKEN` so Dependabot merges retrigger Auto Tag / Test on main.
- Weekly Deploy called unreachable `geoffsee/caretta-action` (404 every Monday); patch ships a lockfile-based safety-net release instead.
- Update-outdated-PRs must comment as `RELEASE_TOKEN` (Dependabot ignores `GITHUB_TOKEN` rebase comments).
- Auto Tag should reformat `package.json` after `npm version` so Release lint stays green.

Related: https://github.com/geoffsee/tx-monitor/issues/81
