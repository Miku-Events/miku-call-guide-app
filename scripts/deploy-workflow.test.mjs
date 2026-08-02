import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

async function deploymentWorkflow() {
  return readFile(path.join(process.cwd(), '.github/workflows/deploy.yml'), 'utf8')
}

async function environmentExample() {
  return readFile(path.join(process.cwd(), '.env.example'), 'utf8')
}

async function projectReadme() {
  return readFile(path.join(process.cwd(), 'README.md'), 'utf8')
}

async function projectManifest() {
  return JSON.parse(
    await readFile(path.join(process.cwd(), 'package.json'), 'utf8'),
  )
}

async function operationsSecurityGuide() {
  return readFile(path.join(process.cwd(), 'docs/operations-security.md'), 'utf8')
}

async function wranglerConfig() {
  return readFile(path.join(process.cwd(), 'wrangler.toml'), 'utf8')
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
    expect(workflow).not.toContain('release_sha:')
    expect(workflow).not.toContain('production_hostname_confirmation:')
    expect(workflow).not.toContain('operations_checklist_url:')
    expect(workflow).not.toContain('bootstrap_readiness_contract:')
    expect(workflow).not.toContain('validate-production-deploy-inputs.mjs')
    expect(workflow).toContain(`PRODUCTION_RELEASE: \${{ ${releaseExpression} }}`)
    expect(workflow).toContain('if [[ "$PRODUCTION_RELEASE" != "true" ]]; then')
    expect(previewJob).toContain(`    if: ${releaseExpression}`)
    expect(deployJob).toContain(`    if: ${releaseExpression}`)
    expect(workflow).not.toContain(
      'if [[ "${{ github.event_name }}" != "workflow_dispatch" ]]; then',
    )
  })

  it('never cancels an active release workflow when another run starts', async () => {
    const workflow = await deploymentWorkflow()

    expect(workflow).toMatch(/concurrency:\s*[\s\S]*?cancel-in-progress:\s*false/)
    expect(workflow).not.toContain('cancel-in-progress: true')
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
    expect(workflow).not.toContain('environment: production')
  })

  it('pins Node 24 actions, stable runners, and strict artifact digest verification', async () => {
    const workflow = await deploymentWorkflow()
    const checkout =
      'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1'
    const setupNode =
      'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0'
    const uploadArtifact =
      'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1'
    const downloadArtifact =
      'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1'

    expect(workflow.match(/runs-on: ubuntu-24\.04/g)).toHaveLength(5)
    expect(workflow).not.toContain('ubuntu-latest')
    expect(workflow.split(checkout)).toHaveLength(6)
    expect(workflow.split(setupNode)).toHaveLength(6)
    expect(workflow.split(uploadArtifact)).toHaveLength(2)
    expect(workflow.split(downloadArtifact)).toHaveLength(4)
    expect(workflow.match(/digest-mismatch: error/g)).toHaveLength(3)
    expect(workflow).not.toContain('continue-on-error: true')
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

  it('uses the selected main commit SHA throughout build, preview, and production smoke', async () => {
    const workflow = await deploymentWorkflow()

    expect(workflow).toContain('VITE_RELEASE_ID=$GITHUB_SHA')
    expect(workflow).toContain('EXPECTED_RELEASE_ID: ${{ github.sha }}')
    expect(workflow).not.toContain('inputs.')
  })

  it('publishes without a current-production readiness preflight or bootstrap bypass', async () => {
    const workflow = await deploymentWorkflow()
    const reconcile = workflow.indexOf('name: Reconcile legacy Pages runtime binding')
    const publish = workflow.indexOf('name: Publish to Cloudflare Pages')

    expect(reconcile).toBeGreaterThan(-1)
    expect(publish).toBeGreaterThan(-1)
    expect(reconcile).toBeLessThan(publish)
    expect(workflow).toContain('node scripts/reconcile-pages-config.mjs')
    expect(workflow).toContain('CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}')
    expect(workflow).toContain('CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}')
    expect(workflow).not.toContain('pre-deploy-readiness.mjs')
    expect(workflow).not.toContain('READINESS_BOOTSTRAP_MODE')
  })

  it('uses the canonical Pages data manifest in the environment example', async () => {
    const environment = await environmentExample()

    expect(environment).toContain(
      'VITE_DATA_MANIFEST_URL=https://miku-call-guide-data.pages.dev/manifest.json',
    )
    expect(environment).not.toContain('cdn.jsdelivr.net')
    expect(environment).not.toContain('@release/manifest.json')
  })

  it('declares the canonical production origin and Turnstile hostname in Pages runtime config', async () => {
    const wrangler = await wranglerConfig()

    expect(wrangler).toContain('APP_ENV = "production"')
    expect(wrangler).toContain(
      'APP_ORIGIN = "https://miku-call-guide-app.pages.dev"',
    )
    expect(wrangler).toContain(
      'TURNSTILE_EXPECTED_HOSTNAME = "miku-call-guide-app.pages.dev"',
    )
  })

  it('documents automatic main releases and manual reruns without stale guards', async () => {
    const [readme, operationsGuide] = await Promise.all([
      projectReadme(),
      operationsSecurityGuide(),
    ])

    expect(readme).toContain('runtime-config-v1')
    expect(readme).toContain('`main` push')
    expect(operationsGuide).toContain('input 없는 `workflow_dispatch`')
    expect(operationsGuide).not.toContain('`main` push는 품질 검사만 실행합니다.')
    expect(operationsGuide).not.toContain('`workflow_dispatch`에서만 시작')
    expect(readme).not.toContain('expected canonical origin')
    expect(readme).not.toContain('환경 승인')
  })
})
