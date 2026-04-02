/* eslint-disable @typescript-eslint/no-unused-vars */
// biome-ignore lint: test fixture for fixable rule coverage
import { readFileSync } from "fs"
import { join } from "path"
var mutableVar = 1
let neverReassigned = 2
const arrowBody = (x: number) => { return x }
const funcExpr = function(x: number) { return x }
const template = "hello" + " " + "world"
const doubleEq = (x: number) => x == 1
const eqNull = (x: number | null) => x == null
const negZero = (x: number) => x === -0
for (let i = 0; i > 10; i++) { break }
debugger
const extraBool = (x: string) => {
  if (!!x) return true
  return false
}
const implicitCoerce = (x: string) => +x
const unneededTernary = (x: boolean) => x ? true : false
const unsafeNeg = (x: unknown) => !x instanceof Error
label: { break label }
const uselessComputed = { ['key']: 1 }
const uselessEscape = "hello\#world"
const newWrapper = new String("hello")
const regexSpaces = /foo  bar/
const elseReturn = (x: number) => {
  if (x > 0) {
    return "positive"
  } else {
    return "negative"
  }
}
const operatorAssign = (x: number) => {
  let n = x
  n = n + 1
  return n
}
const mathPow = Math.pow(2, 10)
const numericLit = parseInt("0xFF", 16)
const parseNoRadix = parseInt("10")
const hasOwnProp = Object.prototype.hasOwnProperty.call({}, "key")
const objSpread = Object.assign({}, { a: 1 })
const isNanCheck = (x: number) => x === NaN
const typeofCheck = typeof mutableVar === "strig"
const yodaCheck = (x: number) => 1 === x
const asyncNoAwait = async () => 1
const arrType: Array<string> = []
// @ts-ignore
const tsIgnored = 1
const genericConstructor: Map<string, number> = new Map()
interface IndexSig { [key: string]: number }
const confusingVoid = void 0
type DuplicateUnion = string | string
const anyVal: any = 1
const voidMeaningless = void undefined
const unnecessaryAssertion = "hello" as string
const wrapperType: String = "hello"
const asConst = "hello" as "hello"
interface FnInterface { (): void }
const includesCheck = "hello".indexOf("l") !== -1
module OldModule {}
const nullishFallback = (x: string | null) => x || "default"
const reduceType = [1, 2].reduce((acc: number[], x) => [...acc, x], [] as number[])
const promiseFunc = (): Promise<number> => Promise.resolve(1)
const catchBadName = async () => {
  try { await Promise.resolve() }
  catch(e) { throw e }
}
const dateClone = (d: Date) => new Date(d.getTime())
const existenceCheck = (arr: number[]) => arr.indexOf(5) !== -1
const emptyBraces = (x: number) => {
  if (x > 0) {  }
}
const hexEscape = "\x41"
const lengthCheck = (arr: number[]) => {
  if (arr.length) return true
  return false
}
const arrayReverse = (arr: number[]) => arr.reverse()
const arraySort = (arr: number[]) => arr.sort()
const awaitMember = async () => (await Promise.resolve({ x: 1 })).x
const consoleSpaces = () => console.log(" hello ")
const instanceofArr = (x: unknown) => x instanceof Array
const sliceEnd = (arr: number[]) => arr.slice(0, arr.length)
const singlePromise = async () => Promise.all([Promise.resolve(1)])
class StaticOnly { static foo() { return 1 } }
const typeofUndefined = (x: unknown) => typeof x === "undefined"
const spliceCount = (arr: number[]) => arr.splice(0, arr.length)
const awaitString = async () => await "hello"
const uselessSpread = (arr: number[]) => [...arr]
const zeroFraction = 1.0
const numCase = 0XFF
const bigNumber = 1000000
const flatConcat = (arrs: number[][]) => ([] as number[]).concat(...arrs)
const flatMap = (arr: number[]) => arr.map(x => [x]).flat()
const arraySome = (arr: number[]) => arr.filter(x => x > 0).length > 0
const lastElement = (arr: number[]) => arr[arr.length - 1]
const charCode = "a".charCodeAt(0)
const dateNow = new Date().getTime()
const mathMinMax = (x: number, y: number) => x > y ? x : y
const negativeIndex = (arr: number[]) => arr.slice(arr.length - 1)
const numberProp = (x: unknown) => isNaN(x as number)
const protoMethod = (args: IArguments) => [].slice.call(args)
const regexpTest = (s: string) => {
  if (s.match(/pattern/)) return true
  return false
}
const arrayFrom = (s: Set<number>) => Array.from(s)
const replaceAll = (s: string) => s.replace(/foo/g, "bar")
const substring = (s: string) => s.substring(1)
const startsWith = (s: string) => s.indexOf("foo") === 0
const trimStart = (s: string) => s.trimLeft()
const typeError = (x: unknown) => {
  if (typeof x !== "string") throw new Error("not a string")
}
const joinNoSep = (arr: string[]) => arr.join()
const toFixedNoArg = (n: number) => n.toFixed()
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
const encodingName = "UTF-8"
const throwNoNew = () => { throw Error("oops") }
const doubleComp = (a: number, b: number) => a >= b && a <= b
const erasingOp = (x: number) => x * 0
const enum ConstEnum { A, B }
const mapSpread = (arr: { x: number }[]) => arr.map(item => ({ ...item, y: 1 }))
const recursiveOnly = (n: number): number => n <= 0 ? 0 : recursiveOnly(n - 1)
const newStatic = () => new Promise.resolve(1)
const uselessResolve = async (x: number) => Promise.resolve(x)
const optionalCatch = async () => {
  try { await Promise.resolve() }
  catch(e) {}
}
const preferSpread2 = (s: string) => Array.from(s)
const stringRaw = `hello\\nworld`
const noUselessFallback = (obj: { key?: string }) => ({ ...obj, key: obj.key ?? "default" })
export {
  mutableVar,
  neverReassigned,
  arrowBody,
  funcExpr,
  template,
  doubleEq,
  eqNull,
  negZero,
  extraBool,
  implicitCoerce,
  unneededTernary,
  unsafeNeg,
  uselessComputed,
  uselessEscape,
  newWrapper,
  regexSpaces,
  elseReturn,
  operatorAssign,
  mathPow,
  numericLit,
  parseNoRadix,
  hasOwnProp,
  objSpread,
  isNanCheck,
  typeofCheck,
  yodaCheck,
  asyncNoAwait,
  arrType,
  tsIgnored,
  genericConstructor,
  confusingVoid,
  anyVal,
  voidMeaningless,
  unnecessaryAssertion,
  wrapperType,
  asConst,
  includesCheck,
  nullishFallback,
  reduceType,
  promiseFunc,
  catchBadName,
  dateClone,
  existenceCheck,
  emptyBraces,
  hexEscape,
  lengthCheck,
  arrayReverse,
  arraySort,
  awaitMember,
  consoleSpaces,
  instanceofArr,
  sliceEnd,
  singlePromise,
  StaticOnly,
  typeofUndefined,
  spliceCount,
  awaitString,
  uselessSpread,
  zeroFraction,
  numCase,
  bigNumber,
  flatConcat,
  flatMap,
  arraySome,
  lastElement,
  charCode,
  dateNow,
  mathMinMax,
  negativeIndex,
  numberProp,
  protoMethod,
  regexpTest,
  arrayFrom,
  replaceAll,
  substring,
  startsWith,
  trimStart,
  typeError,
  joinNoSep,
  toFixedNoArg,
  switchNoBraces,
  encoding,
  encodingName,
  throwNoNew,
  doubleComp,
  erasingOp,
  ConstEnum,
  mapSpread,
  recursiveOnly,
  newStatic,
  uselessResolve,
  optionalCatch,
  preferSpread2,
  stringRaw,
  noUselessFallback,
}
export type { DuplicateUnion, IndexSig, FnInterface }
