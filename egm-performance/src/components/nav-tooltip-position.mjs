export function navTooltipPosition(anchor, tooltip, viewport) {
  const gutter = 12
  const left = Math.max(gutter, Math.min(anchor.left + (anchor.width - tooltip.width) / 2, viewport.width - tooltip.width - gutter))
  const below = anchor.bottom + 8
  const top = below + tooltip.height <= viewport.height - gutter ? below : Math.max(gutter, anchor.top - tooltip.height - 8)
  return {left, top}
}
