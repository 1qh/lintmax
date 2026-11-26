#!/usr/bin/env bun
import { CliExitError, readVersion, usage } from './core.js'
import { runGate } from './gate.js'
import { extractAllRules, formatRulesCompact, formatRulesHuman } from './rules.js'
const command = process.argv[2]
const printRules = async () => {
  const isHuman = process.argv.includes('--human')
  const rules = await extractAllRules()
  const output = isHuman ? formatRulesHuman(rules) : formatRulesCompact(rules)
  process.stdout.write(`${output}\n`)
}
const parseLintArgs = (args: string[]) => {
  const separator = args.indexOf('--')
  const options = separator === -1 ? args : args.slice(0, separator)
  const isHuman = options.includes('--human')
  const paths = options.filter(arg => !arg.startsWith('-'))
  if (separator !== -1) paths.push(...args.slice(separator + 1))
  return { isHuman, paths }
}
const runLintCommand = async (version: string) => {
  if (command !== 'fix' && command !== 'check') {
    usage({ version })
    if (command === '--help' || command === '-h') return
    throw new CliExitError({ code: 1 })
  }
  const { isHuman, paths } = parseLintArgs(process.argv.slice(3))
  await runGate({ command, human: isHuman, paths, version })
}
const main = async () => {
  const version = await readVersion()
  if (command === '--version' || command === '-v' || command === 'version') {
    process.stdout.write(`${version}\n`)
    return
  }
  if (command === 'rules') return printRules()
  await runLintCommand(version)
}
try {
  await main()
} catch (error) {
  if (error instanceof CliExitError) {
    if (error.message.length > 0) process.stderr.write(`${error.message}\n`)
    process.exitCode = error.code
  } else throw error
}
