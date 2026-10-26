# Dependabot shipping unstick patches

These files are not live yet. Copy them over `.github/workflows/` with a token
that has **Workflows** write permission:

```bash
cp .github/unstick-patches/dependabot-auto-merge.yml .github/workflows/
cp .github/unstick-patches/update-outdated-prs.yml .github/workflows/
cp .github/unstick-patches/auto-tag.yml .github/workflows/
cp .github/unstick-patches/weekly-deploy.yml .github/workflows/
```

On 2026-10-12 and 2026-10-26 the Supervisor PAT was rejected for workflow paths:

`refusing to allow a Personal Access Token to create or update workflow
without workflow scope` (GH013).

## Why

- Auto-merge via `GITHUB_TOKEN` merges as `github-actions` and skips push workflows (Auto Tag never ran for lockfile bumps like #82 and #86).
- Prefer `pull_request_target` + `RELEASE_TOKEN` so Dependabot merges retrigger Auto Tag / Test on main.
- Weekly Deploy called unreachable `geoffsee/caretta-action` (404 every Monday, including 2026-10-26 run 40286116660); patch ships a lockfile-based safety-net release instead.
- Update-outdated-PRs must comment as `RELEASE_TOKEN` (Dependabot ignores `GITHUB_TOKEN` rebase comments).
- Auto Tag should reformat `package.json` after `npm version` so Release lint stays green.

`RELEASE_TOKEN` also needs Contents, Pull requests, and **Workflows** write.

Related: https://github.com/geoffsee/tx-monitor/issues/81
