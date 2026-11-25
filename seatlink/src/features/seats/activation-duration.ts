export const activationDurations = [300, 600, 900, 1200] as const
// The RPC stores seconds as PostgreSQL int4. Preserve whole minutes below INT_MAX.
export const maxActivationMinutes = Math.floor(2147483647 / 60)
export const maxActivationSeconds = maxActivationMinutes * 60
export type ActivationDuration = number
export const defaultActivationDuration: ActivationDuration = 600
export type SeatActivation = { seat_id: string; duration_seconds: ActivationDuration }

export const isActivationDuration = (seconds: number) => Number.isSafeInteger(seconds) && seconds >= 60 &&
  seconds <= maxActivationSeconds && seconds % 60 === 0

export function parseActivationMinutes(text: string): { seconds: number | null; error: string } {
  const invalid = 'Enter a whole number greater than 0.'
  if (!/^[0-9]+$/.test(text)) return { seconds: null, error: invalid }
  const minutes = Number(text)
  if (minutes > maxActivationMinutes) return { seconds: null, error: `Enter ${maxActivationMinutes} minutes or less.` }
  if (!Number.isSafeInteger(minutes) || minutes <= 0) return { seconds: null, error: invalid }
  return { seconds: minutes * 60, error: '' }
}
