# CI unstick patches (apply when RELEASE_TOKEN has `workflows` write)

Fine-grained PATs without the Workflows permission cannot push
`.github/workflows/*`. Copy these onto main once the token has that scope:

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
