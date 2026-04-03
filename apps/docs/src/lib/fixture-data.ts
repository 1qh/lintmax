export const dirtyCode = `// Helper function to add two numbers
import { readFileSync, existsSync } from "fs";
import { join } from "path";
/* This formats a greeting */
const greet = function(name: string) {
  // Build the message using concatenation
  const message = "Hello, " + name + "!"
  // Return the result
  return message
}
// Process data from file
const processData = function(filePath: string) {
  // Read the file
  const data = readFileSync(filePath, "utf-8")
  return data
}
// Check if path exists
const checkExists = function(p: string) {
  // Use existsSync
  const result = existsSync(p)
  return result
}
// Build a full path
const buildPath = function(dir: string, file: string) {
  // Join the parts
  return join(dir, file)
}
// Constants
const MAX_RETRIES = 3;
const DEFAULT_TIMEOUT = 5000;
const API_BASE = "https://api.example.com";
// Export
export { greet, processData, checkExists, buildPath, MAX_RETRIES, DEFAULT_TIMEOUT, API_BASE }`
export const fixedCode = `import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
const greet = (name: string) => \`Hello, \${name}!\`
const processData = (filePath: string) => readFileSync(filePath, 'utf-8')
const checkExists = (p: string) => existsSync(p)
const buildPath = (dir: string, file: string) => join(dir, file)
const MAX_RETRIES = 3
const DEFAULT_TIMEOUT = 5000
const API_BASE = 'https://api.example.com'
export { API_BASE, buildPath, checkExists, DEFAULT_TIMEOUT, greet, MAX_RETRIES, processData }`
export const checkOutput = `src/magic-work.ts
 biome
  format
  5,12,18,24,36,40,48 lint/complexity/useArrowFunction
  43 lint/style/noUselessElse
  2,3 lint/style/useNodejsImportProtocol
  7 lint/style/useTemplate
 oxlint
  5,12,18,24,36,40,48 eslint(func-names)
  42 eslint(no-else-return)
  7 eslint(prefer-template)
  2,3 eslint-plugin-unicorn(prefer-node-protocol)
  41 eslint-plugin-unicorn(prefer-ternary)
  14 eslint-plugin-unicorn(text-encoding-identifier-case)
 eslint
  41,43 curly
  5,12,18,24,36,40,48 func-names
  43 no-else-return
  54 perfectionist/sort-named-exports
  2 perfectionist/sort-named-imports
  52 perfectionist/sort-union-types
  7 prefer-template
  5,12,18,24,36,40,48 preferArrow/prefer-arrow-functions
 comments
  1,4,6,8,11,13,17,19,23,25,28,35,39,47,51,53 deletable`
export const verboseOutput = `src/magic-work.ts
  5:7   error  Unexpected function expression  func-names
  7:19  error  Unexpected string concatenation  prefer-template
  12:7  error  Unexpected function expression   func-names
  18:7  error  Unexpected function expression   func-names
  24:7  error  Unexpected function expression   func-names
  36:7  error  Unexpected function expression   func-names
  40:7  error  Unexpected function expression   func-names
  41:3  error  Expected curly braces            curly
  42:3  error  Unexpected else after return      no-else-return
  43:3  error  Expected curly braces            curly
  48:7  error  Unexpected function expression   func-names
  2:1   error  Prefer node: protocol            prefer-node-protocol
  3:1   error  Prefer node: protocol            prefer-node-protocol
  14:1  error  Use utf-8 instead of UTF-8       text-encoding-identifier-case
  54:1  error  Sort named exports               sort-named-exports
src/magic-work.ts:5:7 lint/complexity/useArrowFunction
  Use an arrow function instead of a function expression.
    3 | import { join } from "path";
    4 | /* This formats a greeting */
  > 5 | const greet = function(name: string) {
      |               ^^^^^^^^^^^^^^^^^^^^^^^^
    6 |   // Build the message using concatenation
src/magic-work.ts:7:19 lint/style/useTemplate
  Template literals are preferred over string concatenation.
    5 | const greet = function(name: string) {
    6 |   // Build the message using concatenation
  > 7 |   const message = "Hello, " + name + "!"
      |                   ^^^^^^^^^^^^^^^^^^^^^^^
[...350+ more lines of verbose output from biome, oxlint, and eslint...]`
export const checkTokens = 22
export const verboseTokens = 325
