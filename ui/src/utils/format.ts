export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const sec = ms / 1000
  if (sec < 60) return `${sec.toFixed(1)}s`
  const min = Math.floor(sec / 60)
  return `${min}m ${Math.floor(sec % 60)}s`
}

export function formatCost(usd: number): string {
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`
}

export function sortIndicator(active: boolean, asc: boolean): string {
  if (!active) return ''
  return asc ? ' \u25B2' : ' \u25BC'
}
