import assert from 'node:assert/strict'
import { test } from 'node:test'
import { OPERATIONS } from '../src/operations.js'

test('every API operation is unique', () => {
  const operations = OPERATIONS.map(
    (operation) => `${operation.method} ${operation.path}`
  )
  assert.equal(new Set(operations).size, operations.length)
})

test('every remote operation stays inside the public API', () => {
  for (const operation of OPERATIONS) {
    assert.match(operation.path, /^\//)
    assert.doesNotMatch(operation.path, /^\/api(?:\/|$)/)
    assert.doesNotMatch(operation.path, /^\/system(?:\/|$)/)
  }
})
