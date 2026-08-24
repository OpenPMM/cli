import { OPERATIONS } from './operations.js'

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete'])

export function compareApiCoverage(document) {
  const apiOperations = []

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    for (const method of Object.keys(pathItem)) {
      if (!HTTP_METHODS.has(method)) continue
      const operation = pathItem[method]
      apiOperations.push({
        route: `${method.toUpperCase()} ${path}`,
        id: operation.operationId,
        command: operation['x-openpmm-cli-command'],
      })
    }
  }

  const cliOperations = OPERATIONS.map((operation) => ({
    route: `${operation.method} ${operation.path}`,
    id: operation.id,
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
  const mismatchedOperationIds = cliOperations.flatMap((cliOperation) => {
    const apiOperation = apiOperations.find(
      (operation) => operation.route === cliOperation.route
    )
    if (!apiOperation || apiOperation.id === cliOperation.id) return []
    return [
      {
        route: cliOperation.route,
        expected: apiOperation.id,
        actual: cliOperation.id,
      },
    ]
  })

  return {
    apiOperationCount: apiOperations.length,
    missingFromCli,
    missingFromApi,
    duplicateCliOperations,
    mismatchedOperationIds,
    mismatchedCommands,
  }
}
