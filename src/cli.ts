import { CliExitError, readVersion, usage } from './core.js'
import { runInit } from './init.js'
import { runLint } from './pipeline.js'
const command = process.argv[2]
const main = async () => {
  const version = await readVersion()
  if (command === 'init') {
    await runInit()
    return
  }
  if (command === '--version' || command === '-v') {
    process.stdout.write(`${version}\n`)
    return
  }
  if (command !== 'fix' && command !== 'check') {
    usage({ version })
    if (command === '--help' || command === '-h') return
    throw new CliExitError({ code: 1 })
  }
  await runLint({ command })
}
try {
  await main()
} catch (error) {
  if (error instanceof CliExitError) {
    if (error.message.length > 0) process.stderr.write(`${error.message}\n`)
    process.exitCode = error.code
  } else throw error
}
