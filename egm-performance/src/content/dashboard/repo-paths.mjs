// GitHub's popular-paths API reports /blob/main and /blob/HEAD as separate rows for the same file.
const repoPrefix = '/google/elephant-goldfish-model'

const blobHead = `${repoPrefix}/blob/HEAD`
const blobMain = `${repoPrefix}/blob/main`

export function canonicalRepoPath(value) {
  if (typeof value !== 'string') return null
  if (value === blobHead) return blobMain
  if (value.startsWith(`${blobHead}/`)) return `${blobMain}/${value.slice(blobHead.length + 1)}`
  return value
}

export function pathLabel(value) {
  if (typeof value !== 'string' || !value) return '—'
  const path = value === repoPrefix ? '' : value.startsWith(`${repoPrefix}/`) ? value.slice(repoPrefix.length) : value
  if (!path) return 'Repo home'
  if (path === '/tree/main' || path === '/tree/HEAD') return 'Source root'
  const ref = path.match(/^\/(blob|tree)\/(?:main|HEAD)(?=\/|$)/)
  if (!ref) return path
  return path.slice(ref[0].length) || 'Repo home'
}

function isRepoPath(path) {
  if (path !== repoPrefix && !path.startsWith(`${repoPrefix}/`)) return false
  if (/[?#\\\s]/.test(path)) return false
  return !path.split('/').some(part => part === '.' || part === '..')
}

export function repoPathHref(value) {
  const path = canonicalRepoPath(value)
  if (!path || !isRepoPath(path)) return null
  return `https://github.com${path}`
}

/** Combines main and HEAD views of one file. Unique visitors are not summed: the audiences overlap by an unknown amount. */
export function popularPageRows(rows = []) {
  const groups = new Map()
  const extras = []
  for (const row of rows) {
    const path = typeof row?.path === 'string' ? row.path : null
    if (!path || !Number.isFinite(row.count) || row.count < 0) {
      if (row && typeof row === 'object') extras.push(row)
      continue
    }
    const key = canonicalRepoPath(path)
    const group = groups.get(key)
    if (!group) {
      groups.set(key, {path: key, count: row.count, uniques: Number.isFinite(row.uniques) && row.uniques >= 0 ? row.uniques : null, variants: [path]})
    } else {
      group.count += row.count
      group.uniques = null
      group.variants.push(path)
    }
  }
  const pages = [...groups.values()].map(group => ({...group, combined: group.variants.length > 1}))
  pages.sort((a, b) => b.count - a.count || a.path.localeCompare(b.path))
  return [...pages, ...extras]
}
