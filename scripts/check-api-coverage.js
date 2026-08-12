import { OPERATIONS } from '../src/operations.js'

const DEFAULT_OPENAPI_URL = 'https://api.openpmm.com/v1/openapi.json'
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete'])
const openApiUrl = process.argv[2] ?? process.env.OPENPMM_OPENAPI_URL ?? DEFAULT_OPENAPI_URL

const response = await fetch(openApiUrl, {
  headers: { accept: 'application/json' },
})

if (!response.ok)
  throw new Error(`Failed to fetch ${openApiUrl}: HTTP ${response.status}`)

const document = await response.json()
const apiOperations = []

for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
  for (const method of Object.keys(pathItem)) {
    if (HTTP_METHODS.has(method)) apiOperations.push(`${method.toUpperCase()} ${path}`)
  }
}

const cliOperations = OPERATIONS.map(
  (operation) => `${operation.method} ${operation.path}`
)
const missingFromCli = apiOperations.filter(
  (operation) => !cliOperations.includes(operation)
)
const missingFromApi = cliOperations.filter(
  (operation) => !apiOperations.includes(operation)
)
const duplicateCliOperations = cliOperations.filter(
  (operation, index) => cliOperations.indexOf(operation) !== index
)

if (missingFromCli.length || missingFromApi.length || duplicateCliOperations.length) {
  console.error(
    JSON.stringify(
      { missingFromCli, missingFromApi, duplicateCliOperations },
      null,
      2
    )
  )
  process.exit(1)
}

console.log(`CLI covers all ${apiOperations.length} operations from ${openApiUrl}`)
