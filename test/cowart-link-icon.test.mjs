import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')

function readPixelToken(name) {
  const match = styles.match(new RegExp(`--${name}:\\s*(\\d+)px`))
  assert.ok(match, `Missing --${name} pixel token`)
  return Number(match[1])
}

test('keeps the canvas link icon at least three times larger than the tldraw default', () => {
  const iconSize = readPixelToken('cowart-hyperlink-icon-size')
  const hitArea = readPixelToken('cowart-hyperlink-hit-area')

  assert.ok(iconSize >= 45)
  assert.ok(hitArea >= iconSize)
  assert.match(styles, /\.cowart-canvas \.tl-hyperlink__icon\s*{[^}]*width:\s*var\(--cowart-hyperlink-icon-size\)/s)
})
