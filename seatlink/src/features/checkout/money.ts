export function currencyDigits(currency: string) {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
}

export function parseMinorUnits(value: string, currency: string) {
  const digits = currencyDigits(currency)
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${Math.max(1, digits)}})?$`).test(value.trim())) return null
  const [whole, fraction = ''] = value.trim().split('.')
  if (fraction.length > digits) return null
  const minor = BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, '0') || '0')
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return null
  return Number(minor)
}
