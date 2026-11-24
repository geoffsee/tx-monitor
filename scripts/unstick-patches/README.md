# CI unstick patches (apply when RELEASE_TOKEN has `workflows` write)

Fine-grained PATs without the Workflows permission cannot push
`.github/workflows/*`. Prefer `.github/unstick-patches/` (includes Weekly
Deploy). Copy onto main once the token has that scope:

```bash
cp .github/unstick-patches/dependabot-auto-merge.yml .github/workflows/
cp .github/unstick-patches/update-outdated-prs.yml .github/workflows/
cp .github/unstick-patches/auto-tag.yml .github/workflows/
cp .github/unstick-patches/weekly-deploy.yml .github/workflows/
```

What they fix:

- auto-merge via `pull_request_target` + `RELEASE_TOKEN` so Dependabot merges
  trigger Auto Tag / Test on main (GITHUB_TOKEN merges do not)
- outdated-PR rebases comment as RELEASE_TOKEN (Dependabot rejects GITHUB_TOKEN)
- Weekly Deploy safety-net release instead of missing `caretta-action`
- format package.json after `npm version` so Release lint stays green

Last GH013 rejection: 2026-11-24. Manual ship that week: pending for #99
(and `@xyflow/react` 13 once merged) while live workflow patches remain blocked.
