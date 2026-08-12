import assert from 'node:assert/strict'
import { test } from 'node:test'
import { OPERATIONS } from '../src/operations.js'

test('every API operation and command is unique', () => {
  const operations = OPERATIONS.map(
    (operation) => `${operation.method} ${operation.path}`
  )
  const commands = OPERATIONS.map((operation) => operation.command)

  assert.equal(new Set(operations).size, operations.length)
  assert.equal(new Set(commands).size, commands.length)
})

test('every remote operation stays inside the public API', () => {
  for (const operation of OPERATIONS) {
    assert.match(operation.path, /^\//)
    assert.doesNotMatch(operation.path, /^\/api(?:\/|$)/)
    assert.doesNotMatch(operation.path, /^\/system(?:\/|$)/)
  }
})
