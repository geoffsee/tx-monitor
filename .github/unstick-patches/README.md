# Dependabot shipping unstick patches

These files are not live yet. Copy them over `.github/workflows/` with a token
that has **Workflows** write permission:

```bash
cp .github/unstick-patches/dependabot-auto-merge.yml .github/workflows/
cp .github/unstick-patches/update-outdated-prs.yml .github/workflows/
cp .github/unstick-patches/auto-tag.yml .github/workflows/
cp .github/unstick-patches/weekly-deploy.yml .github/workflows/
```

On 2026-10-12, 2026-10-26, 2026-11-09, 2026-11-16, and 2026-11-24 the
Supervisor PAT was rejected for workflow paths:

`refusing to allow a Personal Access Token to create or update workflow
without workflow scope` (GH013).

On 2026-11-16 the same PAT also could not `workflow_dispatch` Auto Tag or
comment on #81 (403). Shipping was unblocked by manually cutting `v1.1.17`
for Dependabot #97/#98 lockfile bumps that never triggered Auto Tag.

On 2026-11-24 Weekly Deploy failed again on missing `caretta-action`
(run 45155783377), Auto Tag still skipped for Dependabot #99's GITHUB_TOKEN
merge, and major `@xyflow/react` #100 was stuck on merge conflicts plus a
`colorMode` → `forceColorMode` typecheck break. The app migration landed on
main as `42fac98` and Auto Tag cut `v1.1.18`; live workflow copies still
need Workflows write on `RELEASE_TOKEN` (GH013 again this week).

## Why

- Auto-merge via `GITHUB_TOKEN` merges as `github-actions` and skips push workflows (Auto Tag never ran for lockfile bumps like #82, #86, #97, #98, #99).
- Prefer `pull_request_target` + `RELEASE_TOKEN` so Dependabot merges retrigger Auto Tag / Test on main.
- Weekly Deploy called unreachable `geoffsee/caretta-action` (404 every Monday, including 2026-11-16 run 43836705198 and 2026-11-23 run 45155783377); patch ships a lockfile-based safety-net release instead.
- Update-outdated-PRs must comment as `RELEASE_TOKEN` (Dependabot ignores `GITHUB_TOKEN` rebase comments).
- Auto Tag should reformat `package.json` after `npm version` so Release lint stays green.

`RELEASE_TOKEN` also needs Contents, Pull requests, Actions, and **Workflows** write.

Related: https://github.com/geoffsee/tx-monitor/issues/81
