#!/usr/bin/env bun
import { CliExitError, readVersion, usage } from './core.js'
import { runGate } from './gate.js'
import { extractAllRules, formatRulesCompact, formatRulesHuman } from './rules.js'

const command = process.argv[2]
const main = async () => {
  const version = await readVersion()
  if (command === '--version' || command === '-v' || command === 'version') {
    process.stdout.write(`${version}\n`)
    return
  }
  if (command === 'rules') {
    const human = process.argv.includes('--human')
    const rules = await extractAllRules()
    const output = human ? formatRulesHuman(rules) : formatRulesCompact(rules)
    process.stdout.write(`${output}\n`)
    return
  }
  if (command !== 'fix' && command !== 'check') {
    usage({ version })
    if (command === '--help' || command === '-h') return
    throw new CliExitError({ code: 1 })
  }
  const human = process.argv.includes('--human')
  await runGate({ command, human, version })
}
try {
  await main()
} catch (error) {
  if (error instanceof CliExitError) {
    if (error.message.length > 0) process.stderr.write(`${error.message}\n`)
    process.exitCode = error.code
  } else throw error
}
