export function tableLabel(number: number): string {
 if (number < 1) return String(number)
 let result = ''
 for (let n = number; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result
 return result
}
export const seatNumber = (label: string) => /^[A-Z]$/i.test(label) ? label.toUpperCase().charCodeAt(0) - 64 : label
export const seatReference = (table: number, label: string) => `Table ${tableLabel(table)} · Seat ${seatNumber(label)}`
