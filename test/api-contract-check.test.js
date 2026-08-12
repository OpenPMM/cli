import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compareApiCoverage } from '../scripts/check-api-coverage.js'
import { OPERATIONS } from '../src/operations.js'

function apiDocument() {
  const paths = {}
  for (const operation of OPERATIONS) {
    const pathItem = (paths[operation.path] ??= {})
    pathItem[operation.method.toLowerCase()] = {
      'x-openpmm-cli-command': operation.command,
    }
  }
  return { paths }
}

test('deployed API coverage includes every CLI command name', () => {
  const result = compareApiCoverage(apiDocument())

  assert.equal(result.apiOperationCount, OPERATIONS.length)
  assert.deepEqual(result.missingFromCli, [])
  assert.deepEqual(result.missingFromApi, [])
  assert.deepEqual(result.duplicateCliOperations, [])
  assert.deepEqual(result.mismatchedCommands, [])
})

test('deployed API coverage reports a command rename', () => {
  const document = apiDocument()
  const operation = OPERATIONS[0]
  document.paths[operation.path][operation.method.toLowerCase()][
    'x-openpmm-cli-command'
  ] = 'renamed command'

  assert.deepEqual(compareApiCoverage(document).mismatchedCommands, [
    {
      route: `${operation.method} ${operation.path}`,
      expected: 'renamed command',
      actual: operation.command,
    },
  ])
})
