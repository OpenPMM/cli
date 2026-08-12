import { OPERATIONS } from '../src/operations.js'
import { pathToFileURL } from 'node:url'

const DEFAULT_OPENAPI_URL = 'https://api.openpmm.com/v1/openapi.json'
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete'])
export function compareApiCoverage(document) {
  const apiOperations = []

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    for (const method of Object.keys(pathItem)) {
      if (HTTP_METHODS.has(method)) {
        const operation = pathItem[method]
        apiOperations.push({
          route: `${method.toUpperCase()} ${path}`,
          command: operation['x-openpmm-cli-command'],
        })
      }
    }
  }

  const cliOperations = OPERATIONS.map((operation) => ({
    route: `${operation.method} ${operation.path}`,
    command: operation.command,
  }))
  const apiRoutes = apiOperations.map((operation) => operation.route)
  const cliRoutes = cliOperations.map((operation) => operation.route)
  const missingFromCli = apiRoutes.filter(
    (operation) => !cliRoutes.includes(operation)
  )
  const missingFromApi = cliRoutes.filter(
    (operation) => !apiRoutes.includes(operation)
  )
  const duplicateCliOperations = cliRoutes.filter(
    (operation, index) => cliRoutes.indexOf(operation) !== index
  )
  const mismatchedCommands = cliOperations.flatMap((cliOperation) => {
    const apiOperation = apiOperations.find(
      (operation) => operation.route === cliOperation.route
    )
    if (!apiOperation || apiOperation.command === cliOperation.command)
      return []
    return [
      {
        route: cliOperation.route,
        expected: apiOperation.command,
        actual: cliOperation.command,
      },
    ]
  })

  return {
    apiOperationCount: apiOperations.length,
    missingFromCli,
    missingFromApi,
    duplicateCliOperations,
    mismatchedCommands,
  }
}

async function main() {
  const openApiUrl =
    process.argv[2] ?? process.env.OPENPMM_OPENAPI_URL ?? DEFAULT_OPENAPI_URL
  const response = await fetch(openApiUrl, {
    headers: { accept: 'application/json' },
  })

  if (!response.ok)
    throw new Error(`Failed to fetch ${openApiUrl}: HTTP ${response.status}`)

  const result = compareApiCoverage(await response.json())
  const failed =
    result.missingFromCli.length ||
    result.missingFromApi.length ||
    result.duplicateCliOperations.length ||
    result.mismatchedCommands.length

  if (failed) {
    console.error(JSON.stringify(result, null, 2))
    process.exit(1)
  }

  console.log(
    `CLI covers all ${result.apiOperationCount} operations and command names from ${openApiUrl}`
  )
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main()
