export const THEME = {
  ink: 'text',
  muted: 'inactive',
  line: 'subtle',
  accent: 'claude',
  done: 'success',
  partial: 'warning',
  pending: 'warning',
} as const

const MID = {
  clay: '#D97757',
  green: '#3FA35B',
  amber: '#C98A1B',
  gray: '#8A8984',
  track: 'rgba(138,137,132,0.32)',
}

export function ring(done: number, total: number): string {
  const length = 94.2
  const filled = total === 0 ? 0 : (length * done) / total

  return `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" fill="none" stroke="${MID.track}" stroke-width="3.5"/><circle cx="18" cy="18" r="15" fill="none" stroke="${MID.clay}" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="${filled.toFixed(1)} ${length}" transform="rotate(-90 18 18)"/></svg>`
}
