import { describe, expect, test } from 'bun:test'
import { isRetired, versionsToRetire } from '../../../tools/prune-versions.js'
describe('versionsToRetire', () => {
  test('retires only a non-current version without a deprecated field', () => {
    const selected = versionsToRetire({ versions: { '1': { deprecated: 'superseded by latest' }, '2': {}, '3': {} } }, '3')
    expect(selected.length).toBeGreaterThan(0)
    expect(selected).toStrictEqual(['2'])
  })
  test('keeps the only current version', () => {
    expect(versionsToRetire({ versions: { '3': {} } }, '3')).toStrictEqual([])
  })
  test('does not invent versions absent from the registry versions', () => {
    const selected = versionsToRetire({ time: { '2': '2026-01-01T00:00:00.000Z' }, versions: { '1': {}, '3': {} } }, '3')
    expect(selected.length).toBeGreaterThan(0)
    expect(selected).toStrictEqual(['1'])
  })
  test('skips an existing deprecated field even when its message is empty', () => {
    expect(versionsToRetire({ versions: { '1': { deprecated: '' }, '3': {} } }, '3')).toStrictEqual([])
  })
})
describe('isRetired', () => {
  test('reads a version as retired only when it is gone or deprecated', () => {
    const document = { versions: { '1': { deprecated: 'superseded by latest' }, '2': {} } }
    expect(['1', '2', '3'].map(v => isRetired(document, v))).toStrictEqual([true, false, true])
  })
})
