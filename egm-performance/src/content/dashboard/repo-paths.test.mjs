import test from 'node:test'
import assert from 'node:assert/strict'
import {canonicalRepoPath, pathLabel, popularPageRows, repoPathHref} from './repo-paths.mjs'

const main = '/google/elephant-goldfish-model/blob/main/docs/getting_started.md'
const head = '/google/elephant-goldfish-model/blob/HEAD/docs/getting_started.md'
const harness = '/google/elephant-goldfish-model/blob/main/docs/harnesses.md'

test('main and HEAD views of one file combine without summing visitors', () => {
  const pages = popularPageRows([
    {path: harness, count: 856, uniques: 743},
    {path: main, count: 406, uniques: 335},
    {path: head, count: 360, uniques: 313}
  ])
  assert.equal(pages[0].path, harness)
  assert.equal(pages[0].count, 856)
  assert.equal(pages[0].uniques, 743)
  assert.equal(pages[0].combined, false)
  assert.equal(pages[1].path, main)
  assert.equal(pages[1].count, 766)
  assert.equal(pages[1].uniques, null)
  assert.equal(pages[1].combined, true)
  assert.deepEqual(pages[1].variants, [main, head])
})

test('different files and non-blob paths stay separate', () => {
  const tree = '/google/elephant-goldfish-model/tree/main/docs'
  const pages = popularPageRows([
    {path: main, count: 4, uniques: 3},
    {path: tree, count: 9, uniques: 2},
    {path: '/google/elephant-goldfish-model/issues', count: 1, uniques: 1}
  ])
  assert.equal(pages.length, 3)
  assert.equal(pages.find(row => row.path === tree).count, 9)
  assert.equal(canonicalRepoPath(tree), tree)
})

test('path labels hide the repository prefix and git ref', () => {
  assert.equal(pathLabel('/google/elephant-goldfish-model'), 'Repo home')
  assert.equal(pathLabel('/google/elephant-goldfish-model/tree/main'), 'Source root')
  assert.equal(pathLabel('/google/elephant-goldfish-model/tree/HEAD'), 'Source root')
  assert.equal(pathLabel(head), '/docs/getting_started.md')
  assert.equal(pathLabel('/google/elephant-goldfish-model/issues'), '/issues')
  assert.equal(pathLabel(null), '—')
})

test('repo links use the main URL and reject traversal', () => {
  assert.equal(repoPathHref(head), `https://github.com${main}`)
  assert.equal(repoPathHref('/google/elephant-goldfish-model/blob/main/../../etc/passwd'), null)
  assert.equal(repoPathHref('https://evil.example/blob/HEAD/docs/getting_started.md'), null)
  assert.equal(repoPathHref('/other/repo/blob/HEAD/docs/getting_started.md'), null)
  assert.equal(canonicalRepoPath('/google/elephant-goldfishXmodel/blob/HEAD/docs/a.md'), '/google/elephant-goldfishXmodel/blob/HEAD/docs/a.md')
  assert.equal(repoPathHref('/google/elephant-goldfishXmodel'), null)
})
