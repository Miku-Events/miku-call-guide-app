import type { ContractValidator } from '../../../data-contracts/validators.mjs'

function formatContractErrors<T>(validator: ContractValidator<T>): string {
  return (validator.errors ?? [])
    .slice(0, 5)
    .map((error) => {
      const params = Object.keys(error.params).length > 0 ? ` ${JSON.stringify(error.params)}` : ''
      return `${error.instancePath || '/'} ${error.message ?? error.keyword}${params}`
    })
    .join('; ')
}

export function assertContract<T>(
  value: unknown,
  validator: ContractValidator<T>,
  label: string,
): asserts value is T {
  if (!validator(value)) {
    throw new Error(`${label} did not match the generated data contract: ${formatContractErrors(validator) || 'unknown validation error'}`)
  }
}
