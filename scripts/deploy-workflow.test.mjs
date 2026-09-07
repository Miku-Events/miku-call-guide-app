import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

async function deploymentWorkflow() {
  return readFile(path.join(process.cwd(), '.github/workflows/deploy.yml'), 'utf8')
}

async function environmentExample() {
  return readFile(path.join(process.cwd(), '.env.example'), 'utf8')
}

async function projectManifest() {
  return JSON.parse(
    await readFile(path.join(process.cwd(), 'package.json'), 'utf8'),
  )
}

async function wranglerConfig() {
  return readFile(path.join(process.cwd(), 'wrangler.toml'), 'utf8')
}

function workflowActions(workflow) {
  return [...workflow.matchAll(/^\s*-?\s*uses:\s+([^\s#]+)(?:\s+#\s*(\S+))?$/gm)]
    .map(([, reference, version]) => ({ reference, version }))
}

describe('production deployment workflow', () => {
  it('deploys validated main pushes and supports an inputless manual rerun', async () => {
    const workflow = await deploymentWorkflow()
    const releaseExpression =
      "github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch')"
    const previewJob = workflow.slice(
      workflow.indexOf('\n  preview:'),
      workflow.indexOf('\n  deploy:'),
    )
    const deployJob = workflow.slice(workflow.indexOf('\n  deploy:'))

    expect(workflow).toMatch(/workflow_dispatch:\s*(?:\n|$)/)
    expect(workflow).toMatch(/\n  push:\n    branches:\n      - main\n/)
    expect(workflow).toContain(`PRODUCTION_RELEASE: \${{ ${releaseExpression} }}`)
    expect(workflow).toContain('if [[ "$PRODUCTION_RELEASE" != "true" ]]; then')
    expect(previewJob).toContain(`    if: ${releaseExpression}`)
    expect(deployJob).toContain(`    if: ${releaseExpression}`)
  })

  it('leaves analytics injection to Pages without a build-time token', async () => {
    const workflow = await deploymentWorkflow()
    const qualityJob = workflow.slice(
      workflow.indexOf('\n  quality:'),
      workflow.indexOf('\n  compatibility:'),
    )
    const configureStep = qualityJob.slice(
      qualityJob.indexOf('name: Configure frontend build'),
      qualityJob.indexOf('\n      - name: Run quality checks and build'),
    )
    const buildStep = qualityJob.slice(
      qualityJob.indexOf('name: Run quality checks and build'),
      qualityJob.indexOf('\n      - name: Build Pages Functions'),
    )

    expect(workflow).not.toContain('WEB_ANALYTICS_TOKEN')
    expect(configureStep).toContain('node scripts/validate-production-build-env.mjs >> "$GITHUB_ENV"')
    expect(buildStep).toContain('run: npm run check')
  })

  it('cancels superseded PR runs but never cancels an active release', async () => {
    const workflow = await deploymentWorkflow()

    expect(workflow).toContain(
      "cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
    )
  })

  it('rejects GitHub Actions skip instructions from pull request titles', async () => {
    const workflow = await deploymentWorkflow()
    const qualityJob = workflow.slice(
      workflow.indexOf('\n  quality:'),
      workflow.indexOf('\n  compatibility:'),
    )
    const guardStart = qualityJob.indexOf(
      'name: Reject workflow skip instructions in pull request title',
    )
    const guardEnd = qualityJob.indexOf('\n      - name: Checkout repository')
    const guard = qualityJob.slice(guardStart, guardEnd)
    const guardRun = guard.slice(guard.indexOf('\n        run: |'))
    const skipKeywords = [...guard.matchAll(/-e '(\[[^']+\])'/g)]
      .map(([, keyword]) => keyword)
    const titleIsBlocked = (title) => skipKeywords.some(
      (keyword) => title.toLowerCase().includes(keyword),
    )

    expect(guardStart).toBeGreaterThan(-1)
    expect(guardEnd).toBeGreaterThan(guardStart)
    expect(guard).toContain("if: github.event_name == 'pull_request'")
    expect(guard).toContain('PULL_REQUEST_TITLE: ${{ github.event.pull_request.title }}')
    expect(guard).toContain('grep -Fqi')
    expect(guardRun).toContain('"$PULL_REQUEST_TITLE"')
    expect(guardRun).not.toContain('${{')
    expect(skipKeywords).toEqual([
      '[skip ci]',
      '[ci skip]',
      '[no ci]',
      '[skip actions]',
      '[actions skip]',
    ])
    for (const keyword of skipKeywords) {
      expect(titleIsBlocked(`Release ${keyword.toUpperCase()} guard`)).toBe(true)
    }
    expect(titleIsBlocked('Document how to skip CI locally')).toBe(false)
    expect(titleIsBlocked('Fix [skip cider] parsing')).toBe(false)
    expect(workflow).not.toContain('github.event.pull_request.body')
    expect(workflow).toContain(
      '# Repository squash merge messages are configured without PR bodies.',
    )
  })

  it('validates only the vendored contract provenance and never checks out another repository', async () => {
    const workflow = await deploymentWorkflow()

    expect(workflow).toContain('npm run check')
    expect(workflow).toContain('npm run check:functions')
    expect(workflow).not.toContain('compat/data')
    expect(workflow).not.toContain('COMPAT_REPOSITORY_TOKEN')
    expect(workflow).not.toContain('Checkout compatible data repository')
  })

  it('deploys the same enforced-CSP artifact to preview before production', async () => {
    const workflow = await deploymentWorkflow()
    const preview = workflow.indexOf('name: Deploy and browser-smoke enforced-CSP preview')
    const production = workflow.indexOf('name: Deploy production artifact')

    expect(preview).toBeGreaterThan(-1)
    expect(production).toBeGreaterThan(preview)
    expect(workflow.slice(production)).toMatch(/\n    needs: preview\n/)
    expect(workflow).not.toContain('VITE_CSP_MODE')
    expect(workflow).not.toContain('preview-dist-')
    expect(workflow.match(/name: web-dist-\$\{\{ github\.sha \}\}/g)).toHaveLength(4)
    expect(workflow).toContain('npm run smoke:preview')
    expect(workflow).toContain('npx playwright install --with-deps chromium')
    expect(workflow.slice(preview, production)).toMatch(/environment:\n      name: preview\n/)
    expect(workflow.slice(production)).toMatch(/environment:\n      name: production\n/)
  })

  it('structurally pins every action, stable runner, and artifact transfer', async () => {
    const workflow = await deploymentWorkflow()
    const actions = workflowActions(workflow)

    const runners = [...workflow.matchAll(/^\s*runs-on:\s*(\S+)$/gm)]
      .map(([, runner]) => runner)
    expect(runners.length).toBeGreaterThan(0)
    expect(new Set(runners)).toEqual(new Set(['ubuntu-24.04']))
    expect(actions.length).toBeGreaterThan(0)
    expect(actions.every(({ reference }) => /@[0-9a-f]{40}$/.test(reference))).toBe(true)
    expect(actions.every(({ version }) => /^v\d+(?:\.\d+){0,2}$/.test(version))).toBe(true)
    const checkoutSteps = workflow.match(
      /\n\s{6}- name: Checkout repository[\s\S]*?(?=\n\s{6}- name:|\n\s{2}\w+:|$)/g,
    ) ?? []
    expect(checkoutSteps.length).toBeGreaterThan(0)
    for (const checkout of checkoutSteps) expect(checkout).toContain('persist-credentials: false')
    const downloads = workflow.match(
      /\n\s{6}- name: Download (?:built|tested) app[\s\S]*?(?=\n\s{6}- name:|\n\s{2}\w+:|$)/g,
    ) ?? []
    expect(downloads.length).toBeGreaterThan(0)
    for (const download of downloads) {
      expect(download).toContain('digest-mismatch: error')
      expect(download).toContain('name: web-dist-${{ github.sha }}')
    }
    expect(workflow).not.toContain('continue-on-error: true')
  })

  it('retains attempt-scoped Playwright diagnostics when built-artifact E2E fails', async () => {
    const workflow = await deploymentWorkflow()
    const e2eJob = workflow.slice(
      workflow.indexOf('\n  e2e:'),
      workflow.indexOf('\n  preview:'),
    )
    const testStep = e2eJob.indexOf('run: npm run test:e2e:ci')
    const diagnosticsStep = e2eJob.indexOf('name: Upload E2E diagnostics')

    expect(testStep).toBeGreaterThan(-1)
    expect(diagnosticsStep).toBeGreaterThan(testStep)
    expect(e2eJob.slice(diagnosticsStep)).toContain('if: failure()')
    expect(e2eJob.slice(diagnosticsStep)).toContain(
      'name: playwright-diagnostics-${{ github.sha }}-attempt-${{ github.run_attempt }}',
    )
    expect(e2eJob.slice(diagnosticsStep)).toContain('test-results')
    expect(e2eJob.slice(diagnosticsStep)).toContain('playwright-report')
    expect(e2eJob.slice(diagnosticsStep)).toContain('if-no-files-found: warn')
    expect(e2eJob.slice(diagnosticsStep)).not.toContain('continue-on-error')
  })

  it('keeps a non-publishing Node 24 compatibility gate during the Node 26 transition', async () => {
    const workflow = await deploymentWorkflow()
    const compatibilityJob = workflow.slice(
      workflow.indexOf('\n  compatibility:'),
      workflow.indexOf('\n  e2e:'),
    )
    const previewJob = workflow.slice(
      workflow.indexOf('\n  preview:'),
      workflow.indexOf('\n  deploy:'),
    )

    expect(compatibilityJob).toContain('node-version: 24.18.1')
    expect(compatibilityJob).toContain('npm install --global npm@11.17.0')
    expect(compatibilityJob).toContain('npm ci')
    expect(compatibilityJob).toContain('npm run check')
    expect(compatibilityJob).toContain('npm run check:functions')
    expect(compatibilityJob).not.toContain('upload-artifact')
    expect(compatibilityJob).not.toContain('dist')
    expect(previewJob).toMatch(
      /needs:\n      - quality\n      - compatibility\n      - e2e\n/,
    )
  })

  it('pins Wrangler across dependencies, function builds, preview, and production', async () => {
    const [workflow, manifest, wrangler] = await Promise.all([
      deploymentWorkflow(),
      projectManifest(),
      wranglerConfig(),
    ])
    const wranglerAction =
      'cloudflare/wrangler-action@ebbaa1584979971c8614a24965b4405ff95890e0 # v4.0.0'
    const expectedFunctionCommand =
      'wrangler pages functions build functions --outdir node_modules/.tmp/pages-functions-build --compatibility-date 2024-09-23 --compatibility-flags nodejs_compat'
    const qualityJob = workflow.slice(
      workflow.indexOf('\n  quality:'),
      workflow.indexOf('\n  compatibility:'),
    )

    expect(manifest.devDependencies.wrangler).toBe('4.118.0')
    expect(manifest.scripts['check:functions']).toBe(expectedFunctionCommand)
    expect(workflow.split(wranglerAction)).toHaveLength(3)
    expect(workflow.match(/wranglerVersion: 4\.118\.0/g)).toHaveLength(2)
    expect(qualityJob.indexOf('npm run check:functions')).toBeGreaterThan(
      qualityJob.indexOf('npm run check'),
    )
    expect(qualityJob.indexOf('npm run check:functions')).toBeLessThan(
      qualityJob.indexOf('actions/upload-artifact@'),
    )
    expect(wrangler).toContain('compatibility_date = "2024-09-23"')
    expect(wrangler).toContain('compatibility_flags = [ "nodejs_compat" ]')
    expect(expectedFunctionCommand).toContain(
      '--outdir node_modules/.tmp/pages-functions-build',
    )
  })

  it('maps the configured Pages production branch and preview branch to exact deploy commands', async () => {
    const workflow = await deploymentWorkflow()
    const previewJob = workflow.slice(
      workflow.indexOf('\n  preview:'),
      workflow.indexOf('\n  deploy:'),
    )
    const productionJob = workflow.slice(workflow.indexOf('\n  deploy:'))
    const previewCommand =
      'command: pages deploy dist --project-name=miku-call-guide-app --branch=release-preview-${{ github.sha }}'
    const productionCommand =
      'command: pages deploy dist --project-name=miku-call-guide-app --branch=main'

    expect(previewJob).toContain(previewCommand)
    expect(previewJob).not.toContain(productionCommand)
    expect(productionJob).toContain(productionCommand)
    expect(productionJob).not.toContain(previewCommand)
    expect(workflow.split(previewCommand)).toHaveLength(2)
    expect(workflow.split(productionCommand)).toHaveLength(2)
  })

  it('uses the selected main commit SHA throughout build, preview, and production smoke', async () => {
    const workflow = await deploymentWorkflow()

    expect(workflow).toContain('VITE_RELEASE_ID=$GITHUB_SHA')
    expect(workflow).toContain('EXPECTED_RELEASE_ID: ${{ github.sha }}')
  })

  it('browser-smokes the configured production origin in place after publishing', async () => {
    const workflow = await deploymentWorkflow()
    const deployJob = workflow.slice(workflow.indexOf('\n  deploy:'))
    const publish = deployJob.indexOf('name: Publish to Cloudflare Pages')
    const browserSmoke = deployJob.indexOf('name: Browser-smoke custom production origin')
    const httpSmoke = deployJob.indexOf('name: Smoke deployed app and data')

    expect(publish).toBeGreaterThan(-1)
    expect(httpSmoke).toBeGreaterThan(publish)
    expect(browserSmoke).toBeGreaterThan(httpSmoke)
    expect(deployJob).toContain(
      'BROWSER_SMOKE_ORIGIN: ${{ vars.VITE_APP_ORIGIN }}',
    )
    expect(deployJob).toContain('run: npm run smoke:browser')
    expect(deployJob).toContain('npx playwright install --with-deps chromium')
  })

  it('uses the canonical Pages data manifest in the environment example', async () => {
    const environment = await environmentExample()

    expect(environment).toContain(
      'VITE_DATA_MANIFEST_URL=https://miku-call-guide-data.pages.dev/manifest.json',
    )
    expect(environment).not.toContain('cdn.jsdelivr.net')
    expect(environment).not.toContain('@release/manifest.json')
  })

  it('separates local, read-only preview, and canonical production runtime configuration', async () => {
    const wrangler = await wranglerConfig()

    expect(wrangler).toContain('[env.preview.vars]')
    expect(wrangler).toContain('APP_ENV = "preview"')
    expect(wrangler).toContain('SUBMISSION_WRITES_ENABLED = "false"')
    expect(wrangler).toContain('[env.production.vars]')
    expect(wrangler).toContain('APP_ENV = "production"')
    expect(wrangler).toContain('APP_ORIGIN = "https://miku.sekai.today"')
    expect(wrangler).toContain('SUBMISSION_WRITES_ENABLED = "true"')
    expect(wrangler).not.toContain('TURNSTILE_EXPECTED_HOSTNAME')
  })

  it('uses distinct preview and production deploy credentials with repository variables only', async () => {
    const workflow = await deploymentWorkflow()
    const previewJob = workflow.slice(
      workflow.indexOf('\n  preview:'),
      workflow.indexOf('\n  deploy:'),
    )
    const productionJob = workflow.slice(workflow.indexOf('\n  deploy:'))

    expect(workflow).toContain('name: preview')
    expect(workflow).toContain('name: production')
    expect(previewJob).toContain(
      'apiToken: ${{ secrets.CLOUDFLARE_PREVIEW_API_TOKEN }}',
    )
    expect(previewJob).not.toContain('secrets.CLOUDFLARE_PRODUCTION_API_TOKEN')
    expect(productionJob).toContain(
      'apiToken: ${{ secrets.CLOUDFLARE_PRODUCTION_API_TOKEN }}',
    )
    expect(productionJob).not.toContain('secrets.CLOUDFLARE_PREVIEW_API_TOKEN')
    expect(workflow).not.toContain('secrets.CLOUDFLARE_API_TOKEN')
    expect(workflow.match(/accountId: \$\{\{ vars\.CLOUDFLARE_ACCOUNT_ID \}\}/g)).toHaveLength(2)
    expect(workflow).not.toMatch(/vars\.[A-Z0-9_]+\s*\|\|\s*secrets\./)
    expect(workflow).not.toContain('secrets.CLOUDFLARE_ACCOUNT_ID')
    expect(workflow).toContain('npm audit signatures')
  })

  it('keeps every pull-request-reachable job free of secrets and privileged triggers', async () => {
    const workflow = await deploymentWorkflow()
    const pullRequestJobs = workflow.slice(
      workflow.indexOf('\n  quality:'),
      workflow.indexOf('\n  preview:'),
    )
    const publishingJobs = workflow.slice(workflow.indexOf('\n  preview:'))

    expect(workflow).not.toContain('pull_request_target:')
    expect(pullRequestJobs).not.toContain('secrets.')
    expect(publishingJobs.match(/secrets\.[A-Z0-9_]+/g)).toEqual([
      'secrets.CLOUDFLARE_PREVIEW_API_TOKEN',
      'secrets.CLOUDFLARE_PRODUCTION_API_TOKEN',
    ])
    expect(publishingJobs.match(/if: github\.ref == 'refs\/heads\/main'/g)).toHaveLength(2)
  })
})
