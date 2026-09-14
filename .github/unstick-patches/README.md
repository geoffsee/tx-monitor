# Dependabot shipping unstick patches (2026-09-14)

Apply these over `.github/workflows/` with a token that has **Workflows** write
permission (`RELEASE_TOKEN` currently lacks it, which blocked Supervisor):

```bash
cp .github/unstick-patches/dependabot-auto-merge.yml .github/workflows/
cp .github/unstick-patches/weekly-deploy.yml .github/workflows/
cp .github/unstick-patches/update-outdated-prs.yml .github/workflows/
```

## Why
- Auto-merge via `GITHUB_TOKEN` merges as `github-actions` and skips push workflows (Auto Tag never ran for #79).
- Weekly Deploy called unreachable `geoffsee/caretta-action` (404 every Monday).
- Update-outdated-PRs needs `RELEASE_TOKEN` + Dependabot author login variants.

Related: https://github.com/geoffsee/tx-monitor/issues/81
