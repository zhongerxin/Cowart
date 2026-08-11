import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const manifestPath = path.join(projectRoot, 'src', 'assets', 'fonts', 'xiaolai-manifest.json')

function unicodeRangeContains(unicodeRange, codePoint) {
  return unicodeRange.split(',').some((part) => {
    const [startHex, endHex = startHex] = part.trim().replace(/^U\+/i, '').split('-')
    return codePoint >= Number.parseInt(startHex, 16) && codePoint <= Number.parseInt(endHex, 16)
  })
}

test('tracks the complete official Excalidraw Xiaolai CJK font manifest', async () => {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))

  assert.equal(manifest.sourcePackage, '@excalidraw/excalidraw')
  assert.equal(manifest.sourceVersion, '0.18.1')
  assert.equal(manifest.family, 'Xiaolai')
  assert.equal(manifest.fontVersion, '3.11')
  assert.equal(manifest.faces.length, 209)
  assert.equal(new Set(manifest.faces.map(({ file }) => file)).size, 209)

  for (const { file, unicodeRange } of manifest.faces) {
    assert.match(file, /^Xiaolai-Regular-[a-f0-9]{32}\.woff2$/)
    assert.match(unicodeRange, /^U\+/)
  }

  for (const character of '场景编辑可视化交互优化中文手绘字体') {
    const codePoint = character.codePointAt(0)
    assert.ok(
      manifest.faces.some(({ unicodeRange }) => unicodeRangeContains(unicodeRange, codePoint)),
      `Expected the Xiaolai subsets to cover ${character}`
    )
  }
})

test('uses Excalidraw font ordering and registers Xiaolai before the canvas mounts', async () => {
  const themeSource = await readFile(path.join(projectRoot, 'src', 'cowartTheme.js'), 'utf8')
  const appSource = await readFile(path.join(projectRoot, 'src', 'App.jsx'), 'utf8')
  const licenseNotice = await readFile(
    path.join(projectRoot, 'src', 'assets', 'fonts', 'FONT-LICENSES.md'),
    'utf8'
  )

  assert.match(themeSource, /"Excalifont", "Xiaolai"/)
  assert.match(themeSource, /https:\/\/cdn\.jsdelivr\.net\/npm\//)
  assert.match(themeSource, /unicode-range:/)
  assert.match(appSource, /installCowartHandDrawnFontFaces\(\)/)
  assert.match(licenseNotice, /Xiaolai 3\.11/)
  assert.match(licenseNotice, /SIL Open Font License 1\.1/)
})
