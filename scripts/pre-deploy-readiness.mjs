import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { runReadinessPreflight } from './post-deploy-smoke.mjs'

async function runCli() {
  const report = await runReadinessPreflight({
    appOrigin: process.env.APP_SMOKE_ORIGIN,
    bootstrapMode: process.env.READINESS_BOOTSTRAP_MODE || '',
  })
  const mode = report.bootstrapRequired ? 'BOOTSTRAP REQUIRED' : 'PASS'
  process.stdout.write(`Pre-deploy readiness: ${mode} (HTTP ${report.status})\n`)
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (invokedPath === import.meta.url) {
  runCli().catch((error) => {
    process.stderr.write(
      `Pre-deploy readiness: FAIL\n${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  })
}
