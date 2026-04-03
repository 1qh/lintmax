/* eslint-disable @typescript-eslint/no-unused-vars */
// biome-ignore lint: test fixture for fixable rule coverage
import { readFileSync } from "node:fs"
import { join } from "node:path"
const mutableVar = 1
const neverReassigned = 2
const arrowBody = (x: number) => x
const funcExpr = (x: number) => x
const template = "hello" + " " + "world"
const doubleEq = (x: number) => x == 1
const eqNull = (x: null | number) => x == null
const negZero = (x: number) => Object.is(x, -0)
for (let i = 0; i > 10; i += 1)  break 
const extraBool = (x: string) => {
  if (x) return true
  return false
}
const implicitCoerce = (x: string) => Number(x)
const unneededTernary = (x: boolean) => Boolean(x)
const unsafeNeg = (x: unknown) => !(x instanceof Error)
label: { break label }
const uselessComputed = { 'key': 1 }
const uselessEscape = "hello#world"
const newWrapper = "hello"
const regexSpaces = /foo {2}bar/
const elseReturn = (x: number) => {
  if (x > 0) 
    return "positive"
  
    return "negative"
  
}
const operatorAssign = (x: number) => {
  let n = x
  n += 1
  return n
}
const mathPow = 2 ** 10
const numericLit = Number.parseInt("0xFF", 16)
const parseNoRadix = Number.parseInt("10")
const hasOwnProp = Object.hasOwn({}, "key")
const objSpread = { a: 1}
const isNanCheck = (x: number) => isNaN(x)
const typeofCheck = typeof mutableVar === "strig"
const yodaCheck = (x: number) => x === 1 
const asyncNoAwait = async () => 1
const arrType: string[] = []
// @ts-expect-error
const tsIgnored = 1
const genericConstructor = new Map<string, number>()
type IndexSig = Record<string, number>;
const confusingVoid = undefined
type DuplicateUnion = string  
const anyVal: any = 1
const voidMeaningless = undefined
const unnecessaryAssertion = "hello" as string
const wrapperType = "hello"
const asConst = "hello" as const
type FnInterface = () => void;
const includesCheck = "hello".includes("l")
namespace OldModule {}
const nullishFallback = (x: null | string) => x || "default"
const reduceType = [1, 2].reduce<number[]>((acc: number[], x) => [...acc, x], [])
const promiseFunc = async (): Promise<number> => Promise.resolve(1)
const catchBadName = async () => {
  try { await Promise.resolve() }
  catch(error) { throw error }
}
const dateClone = (d: Date) => new Date(d)
const existenceCheck = (arr: number[]) => arr.includes(5)
const emptyBraces = (x: number) => {}
const hexEscape = "\u0041"
const lengthCheck = (arr: number[]) => {
  if (arr.length > 0) return true
  return false
}
const arrayReverse = (arr: number[]) => arr.reverse()
const arraySort = (arr: number[]) => arr.sort()
const awaitMember = async () => (await Promise.resolve({ x: 1 })).x
const consoleSpaces = () => console.log(" hello ")
const instanceofArr = (x: unknown) => Array.isArray(x)
const sliceEnd = (arr: number[]) => [...arr]
const singlePromise = async () => Promise.all([Promise.resolve(1)])
class StaticOnly { static foo() { return 1 } }
const typeofUndefined = (x: unknown) => x === undefined
const spliceCount = (arr: number[]) => arr.splice(0)
const awaitString = async () => "hello"
const uselessSpread = (arr: number[]) => [...arr]
const zeroFraction = 1
const numCase = 0xFF
const bigNumber = 1_000_000
const flatConcat = (arrs: number[][]) => ([] as number[]).concat(...arrs)
const flatMap = (arr: number[]) => arr.flatMap(x => [x])
const arraySome = (arr: number[]) => arr.some(x => x > 0)
const lastElement = (arr: number[]) => arr.at(-1)
const charCode = "a".codePointAt(0)
const dateNow = Date.now()
const mathMinMax = (x: number, y: number) => x > y ? x : y
const negativeIndex = (arr: number[]) => arr.slice(- 1)
const numberProp = (x: unknown) => isNaN(x as number)
const protoMethod = (args: IArguments) => Array.prototype.slice.call(args)
const regexpTest = (s: string) => {
  if (s.includes('pattern')) return true
  return false
}
const arrayFrom = (s: Set<number>) => [...s]
const replaceAll = (s: string) => s.replaceAll('foo', "bar")
const substring = (s: string) => s.slice(1)
const startsWith = (s: string) => s.startsWith("foo")
const trimStart = (s: string) => s.trimStart()
const typeError = (x: unknown) => {
  if (typeof x !== "string") throw new Error("not a string")
}
const joinNoSep = (arr: string[]) => arr.join(",")
const toFixedNoArg = (n: number) => n.toFixed(0)
const switchNoBraces = (x: number) => {
  switch (x) {
    case 1:
      return "one"
    case 2:
      return "two"
    default:
      return "other"
  }
}
const encoding = (s: string) => new TextEncoder().encode(s)
const encodingName = "utf8"
const throwNoNew = () => { throw new Error("oops") }
const doubleComp = (a: number, b: number) => a == b
const erasingOp = (x: number) => x * 0
enum ConstEnum { A = 0, B = 1 }
const mapSpread = (arr: { x: number }[]) => arr.map(item => ({ ...item, y: 1 }))
const recursiveOnly = (n: number): number => n <= 0 ? 0 : recursiveOnly(n - 1)
const newStatic = async () => Promise.resolve(1)
const uselessResolve = async (x: number) => x
const optionalCatch = async () => {
  try { await Promise.resolve() }
  catch{}
}
const preferSpread2 = (s: string) => [...s]
const stringRaw = `hello\\nworld`
const noUselessFallback = (obj: { key?: string }) => ({ ...obj, key: obj.key ?? "default" })
 
const arrayConstructor = []
const divRegex = /[=]foo/
const debuggerStmt = () => {}
for (const x of [1])  break 
const isNanFunc = (x: number) => isNaN(x)
interface TypeDef { x: number }
import type { Pkg } from "./core.js"
const confusingVoidExpr = () => undefined
const noImportTypeSide = 1
const nonNullableAssertion = (x: string | undefined) => x!
const unnecessaryTypeArg = Promise.resolve("x")
const uselessEmptyExport = 1
const returnThis = class { method(): this { return this } }
const assertCheck = (x: unknown) => { console.assert(x !== null, "msg") }
const existenceIdx = (arr: number[]) => arr.includes(5)
const escapeSeq = '\u0041'
const reverseArr = (arr: number[]) => arr.reverse()
const sortArr = (arr: number[]) => arr.sort()
const logSpaces = () => console.log(' hello ')
const uselessSpread2 = [1, 2, 3]
const flatArr = (arrs: number[][]) => [].concat(...arrs)
const bigintLit = 123n
class FieldInit { private readonly x = 5;  }
const mathMax = (x: number, y: number) => x > y ? x : y
const setHas = (arr: number[], items: number[]) => { for (const i of items) arr.includes(i) }
const setSize = (s: Set<number>) => [...s].length
const strStartsWith = (s: string) => s.startsWith("foo")
const typeErr = (x: unknown) => { if (typeof x !== "string") throw new Error("bad") }
const relUrl = new URL("path", "https://example.com")
const switchBraces = (x: number) => { switch (x) { case 1: return "a"; case 2: return "b"; default: return "c" } }
const uselessRename = ({ foo }: { foo: string }) => foo
const preserveCaught = async () => { try { await Promise.resolve() } catch{ throw new Error("wrapped", { cause: err }) } }
const onlyRecursion = (n: number, _acc: number): number => n <= 0 ? 0 : onlyRecursion(n - 1, _acc)
const noMapSpread2 = (arr: { x: number }[]) => arr.map(item => ({ ...item, z: 2 }))
const uselessFallback = (obj: { a?: string }) => ({ ...obj, a: obj.a ?? "fallback" })
export {
  anyVal,
  arrayConstructor,
  arrayFrom,
  arrayReverse,
  arraySome,
  arraySort,
  arrowBody,
  arrType,
  asConst,
  assertCheck,
  asyncNoAwait,
  awaitMember,
  awaitString,
  bigintLit,
  bigNumber,
  catchBadName,
  charCode,
  confusingVoid,
  confusingVoidExpr,
  consoleSpaces,
  ConstEnum,
  dateClone,
  dateNow,
  debuggerStmt,
  doubleComp,
  doubleEq,
  elseReturn,
  emptyBraces,
  encoding,
  encodingName,
  eqNull,
  erasingOp,
  escapeSeq,
  existenceCheck,
  existenceIdx,
  extraBool,
  FieldInit,
  flatArr,
  flatConcat,
  flatMap,
  funcExpr,
  genericConstructor,
  hasOwnProp,
  hexEscape,
  implicitCoerce,
  includesCheck,
  instanceofArr,
  isNanCheck,
  isNanFunc,
  joinNoSep,
  lastElement,
  lengthCheck,
  logSpaces,
  mapSpread,
  mathMax,
  mathMinMax,
  mathPow,
  mutableVar,
  negativeIndex,
  negZero,
  neverReassigned,
  newStatic,
  newWrapper,
  noImportTypeSide,
  noMapSpread2,
  nonNullableAssertion,
  noUselessFallback,
  nullishFallback,
  numberProp,
  numCase,
  numericLit,
  objSpread,
  onlyRecursion,
  operatorAssign,
  optionalCatch,
  parseNoRadix,
  preferSpread2,
  preserveCaught,
  promiseFunc,
  protoMethod,
  recursiveOnly,
  reduceType,
  regexpTest,
  regexSpaces,
  relUrl,
  replaceAll,
  returnThis,
  reverseArr,
  setHas,
  setSize,
  singlePromise,
  sliceEnd,
  sortArr,
  spliceCount,
  startsWith,
  StaticOnly,
  stringRaw,
  strStartsWith,
  substring,
  switchBraces,
  switchNoBraces,
  template,
  throwNoNew,
  toFixedNoArg,
  trimStart,
  tsIgnored,
  typeErr,
  typeError,
  typeofCheck,
  typeofUndefined,
  unnecessaryAssertion,
  unnecessaryTypeArg,
  unneededTernary,
  unsafeNeg,
  uselessComputed,
  uselessEmptyExport,
  uselessEscape,
  uselessFallback,
  uselessRename,
  uselessResolve,
  uselessSpread,
  uselessSpread2,
  voidMeaningless,
  wrapperType,
  yodaCheck,
  zeroFraction,
}
export type { DuplicateUnion, FnInterface, IndexSig, Pkg, TypeDef }
