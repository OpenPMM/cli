import { pathToFileURL } from 'node:url'
import { compareApiCoverage } from '../src/api-coverage.js'

const DEFAULT_OPENAPI_URL = 'https://api.openpmm.com/v1/openapi.json'

export { compareApiCoverage } from '../src/api-coverage.js'

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
    result.mismatchedOperationIds.length ||
    result.mismatchedCommands.length

  if (failed) {
    console.error(JSON.stringify(result, null, 2))
    process.exit(1)
  }

  console.log(
    `CLI covers all ${result.apiOperationCount} operation IDs and command names from ${openApiUrl}`
  )
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main()
