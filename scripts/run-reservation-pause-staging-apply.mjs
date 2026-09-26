// Nothing runs on import. --prepare-local / --verify-local perform no hosted I/O.
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPauseCommand } from './reservation-pause-staging-runtime.mjs'

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await runPauseCommand(process.argv.slice(2))))
  } catch {
    // Never print raw errors: assertion differences can contain private catalog
    // definitions, Auth metadata, or CLI connection diagnostics.
    console.error(JSON.stringify({ result: 'STOP', reason: 'Pause runner failed; inspect private evidence. Do not retry.',
      stagingActivityResumed: false, enforcementAuthorized: false }))
    process.exitCode = 1
  }
}
