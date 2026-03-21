# GitHub Actions CI/CD Setup Guide

This guide walks you through setting up the PR Quality Gate workflow for Perfana Next Generation.

## 📋 Prerequisites

- [ ] GitHub repository with admin access
- [ ] Tests are passing locally (≥95% pass rate)
- [ ] Node.js 20+ installed (required by worker dependencies)
- [ ] PostgreSQL and Redis available for local testing

## 🚀 Quick Start (5 minutes)

### Step 1: Commit the Workflow

The workflow file has been created at:
```
.github/workflows/pr-quality-gate.yml
```

Commit and push it to your repository:

```bash
cd /Users/daniel/workspace/perfana-next-gen

git add .github/workflows/
git commit -m "Add PR quality gate workflow with test suite

- Run API, web, and worker tests on every PR
- Enforce 50% coverage threshold
- Type check and linting
- Automatic PR comments on success/failure
- Block merges if tests fail"

git push origin main
```

### Step 2: Enable Branch Protection (2 minutes)

1. Go to your GitHub repository
2. Navigate to: `Settings` → `Branches`
3. Click `Add branch protection rule`

**Configure as follows:**

**Branch name pattern:** `main` (or `master`)

**Protect matching branches:**
- ✅ Require a pull request before merging
  - ✅ Require approvals: **1**
  - ✅ Dismiss stale pull request approvals when new commits are pushed

- ✅ Require status checks to pass before merging
  - ✅ Require branches to be up to date before merging
  - Select these required checks:
    - `API Tests & Coverage`
    - `Web Tests & Coverage`
    - `Worker Tests & Coverage`
    - `TypeScript Type Check`
    - `Code Linting`
    - `Quality Gate Check`

- ✅ Require conversation resolution before merging (optional but recommended)
- ✅ Include administrators (apply to admin users too)
- ✅ Allow force pushes: **OFF**
- ✅ Allow deletions: **OFF**

4. Click **Create** or **Save changes**

### Step 3: Test the Workflow (3 minutes)

Create a test PR to verify everything works:

```bash
# Create a new branch
git checkout -b test-ci-workflow

# Make a small change
echo "# Testing CI" >> README.md

# Commit and push
git add README.md
git commit -m "Test: Verify CI workflow runs"
git push origin test-ci-workflow

# Create PR via GitHub UI or CLI
gh pr create --title "Test: Verify CI workflow" --body "Testing the PR quality gate workflow"
```

Watch the workflow run in the Actions tab. It should:
- Run all 6 jobs in parallel
- Complete in 8-12 minutes
- Post a comment on the PR with results
- Show green checkmarks when passing

## 🎯 What Gets Tested

### API Tests (`apps/api`)
- Unit tests with Jest
- Integration tests with PostgreSQL
- Service layer tests
- Controller tests
- Repository tests
- **Coverage threshold:** ≥50%

### Web Tests (`apps/web`)
- Component tests with React Testing Library
- Integration tests
- UI interaction tests
- Accessibility tests
- **Coverage threshold:** ≥50%

### Worker Tests (`apps/worker`)
- Pipeline tests
- Job queue tests
- Integration tests with PostgreSQL/Redis
- Background job tests
- **Coverage threshold:** ≥50%

### Additional Checks
- TypeScript type checking (all apps)
- ESLint code linting (all apps)
- Quality gate summary (all must pass)

## ⚙️ Configuration Options

### Adjusting Coverage Thresholds

Edit `.github/workflows/pr-quality-gate.yml`:

```yaml
# In each test job, find the coverage check step:
- name: Check API coverage thresholds
  run: |
    cd apps/api
    node -e "
      const coverage = require('./coverage/coverage-summary.json');
      const total = coverage.total;
      if (total.lines.pct < 60) {  # Change from 50 to 60
        console.error('❌ Coverage below 60% threshold');
        process.exit(1);
      }
    "
```

### Changing Test Timeouts

```yaml
jobs:
  test-api:
    timeout-minutes: 20  # Increase from 15 to 20
```

### Adding Slack Notifications

Add this step to the `quality-gate` job:

```yaml
- name: Send Slack notification
  if: always()
  uses: slackapi/slack-github-action@v1
  with:
    webhook: ${{ secrets.SLACK_WEBHOOK_URL }}
    payload: |
      {
        "text": "${{ needs.test-api.result == 'success' && needs.test-web.result == 'success' && needs.test-worker.result == 'success' && '✅' || '❌' }} PR #${{ github.event.pull_request.number }}: Quality Gate ${{ needs.test-api.result == 'success' && needs.test-web.result == 'success' && needs.test-worker.result == 'success' && 'Passed' || 'Failed' }}"
      }
```

Then add `SLACK_WEBHOOK_URL` to GitHub Secrets.

## 📊 Optional: Codecov Integration

For detailed coverage reports and PR comments:

### Step 1: Set up Codecov

1. Go to https://codecov.io
2. Sign in with GitHub
3. Add your repository
4. Copy the upload token

### Step 2: Add Token to GitHub Secrets

1. Go to repository `Settings` → `Secrets and variables` → `Actions`
2. Click `New repository secret`
3. Name: `CODECOV_TOKEN`
4. Value: [paste token from Codecov]
5. Click `Add secret`

### Step 3: Verify

The workflow already includes Codecov upload steps. After the next PR:
- Coverage reports appear on PRs
- Codecov comments show coverage changes
- Dashboard available at codecov.io

## 🔍 Monitoring & Maintenance

### Viewing Workflow Runs

1. Go to `Actions` tab in GitHub
2. Click on a workflow run to see details
3. Click on a job to see logs
4. Download artifacts for detailed test results

### Common Issues

**Tests pass locally but fail in CI:**
- Check Node version (must be 20+, not 18)
- Verify PostgreSQL/Redis are running
- Check environment variables
- Review service container logs

**npm integrity errors (react-remove-scroll, etc):**
- Workflow includes `npm cache clean --force` to prevent this
- **Automatic retry logic** handles transient npm registry corruption (3 attempts)
- If error persists after retries, check package-lock.json is committed
- Try deleting node_modules locally and re-running npm install
- In rare cases, re-run the GitHub Actions workflow

**Workflow times out:**
- Increase `timeout-minutes`
- Optimize slow tests
- Check for hanging promises

**Coverage below threshold:**
- Add more tests
- Check `coverage-summary.json` artifact
- Identify untested files

## 📈 Success Metrics

After setup, you should see:

- ✅ PRs blocked until tests pass
- ✅ Automatic test runs on every push
- ✅ Coverage reports on PRs (with Codecov)
- ✅ Reduced bugs in main branch
- ✅ Faster code reviews (automated checks)
- ✅ Confidence in deployments

## 🎓 Best Practices

### For Developers

1. **Run tests locally** before pushing
   ```bash
   npm test
   npm run type-check
   npm run lint
   ```

2. **Keep PRs small** - Easier to review and faster CI runs

3. **Fix failing tests immediately** - Don't let them accumulate

4. **Monitor coverage trends** - Keep improving over time

5. **Update tests with code changes** - Tests should evolve with the codebase

### For Maintainers

1. **Review workflow logs regularly** - Catch issues early

2. **Update dependencies** - Keep actions and Node.js current

3. **Adjust thresholds gradually** - Increase coverage targets over time

4. **Monitor workflow duration** - Optimize if runs take >15 minutes

5. **Keep documentation updated** - Update this guide as workflow evolves

## 🔐 Security

The workflow is configured securely:

- ✅ No secrets in code (use GitHub Secrets)
- ✅ Service containers isolated per run
- ✅ Test databases destroyed after runs
- ✅ Minimal permissions (read-only by default)
- ✅ Signed commits recommended (optional)

### Adding Required Secrets

If your tests need additional secrets:

1. Go to `Settings` → `Secrets and variables` → `Actions`
2. Add secrets (e.g., API keys for external services)
3. Reference in workflow: `${{ secrets.SECRET_NAME }}`

## 📞 Support

### Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Branch Protection Documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches)
- [Workflow Syntax](https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions)

### Troubleshooting

1. Check workflow logs in Actions tab
2. Review test artifacts
3. Run tests locally with CI environment
4. Check `.github/workflows/README.md`

## ✅ Checklist

Before going live:

- [ ] Workflow file committed and pushed
- [ ] Branch protection rules enabled
- [ ] Test PR created and passes
- [ ] Team notified of new process
- [ ] Documentation reviewed
- [ ] Secrets configured (if needed)
- [ ] Codecov integrated (optional)
- [ ] Monitoring set up (optional)

## 🎉 You're Done!

Your CI/CD pipeline is now active! Every PR will be automatically tested before merging to main.

**What happens next:**

1. Developer creates PR
2. Workflow runs automatically
3. 6 jobs execute in parallel (~10 minutes)
4. Quality gate checks results
5. PR comment posted with status
6. Merge button enabled/disabled based on results

**No more untested code in main branch!** 🚀
