// Complete rows only. A 6-column grid never shows 9 tiles.
export function videoColumns(width) {
  if (width >= 1280) return 6
  if (width >= 800) return 4
  return 3
}

export function videoGrid(available, width) {
  const columns = videoColumns(width)
  if (available <= 0) return { columns: 1, count: 0 }
  if (available < columns) return { columns: available, count: available }
  const full = Math.floor(Math.min(available, columns * 2) / columns) * columns
  return { columns, count: full }
}
