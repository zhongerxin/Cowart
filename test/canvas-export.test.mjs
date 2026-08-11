import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  buildCanvasHtmlDocument,
  canvasExportFileName
} from '../src/canvasExportDocument.js'
import { buildCanvasPptxBase64 } from '../src/canvasPptx.js'

const ONE_PIXEL_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII='

test('canvas export file names are deterministic and use real format extensions', () => {
  const exportedAt = new Date('2026-08-11T03:04:05.000Z')
  assert.equal(canvasExportFileName('html', exportedAt), 'yogurt-ai-canvas-20260811T030405Z.html')
  assert.equal(canvasExportFileName('pptx', exportedAt), 'yogurt-ai-canvas-20260811T030405Z.pptx')
})

test('PptxGenJS keeps its Node-only image parser out of browser bundles', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../node_modules/pptxgenjs/package.json', import.meta.url), 'utf8')
  )
  assert.equal(packageJson.version, '4.0.1')
  assert.equal(packageJson.browser?.['image-size'], false)
  assert.equal(packageJson.browser?.['node:fs'], false)
})

test('standalone canvas HTML contains the overview and safely escaped outline data', () => {
  const html = buildCanvasHtmlDocument({
    title: '玩法 <全景>',
    exportedAt: '2026/8/11 11:04:05',
    overview: {
      dataUrl: ONE_PIXEL_PNG,
      width: 1200,
      height: 800,
      bounds: { x: -20, y: 10, w: 600, h: 400 }
    },
    items: [{
      shapeId: 'shape:card',
      type: '卡片',
      title: '核心循环',
      text: '</script><script>window.bad=true</script>',
      bounds: { x: 40, y: 60, w: 200, h: 120 }
    }]
  })

  assert.match(html, /<title>玩法 &lt;全景&gt;<\/title>/)
  assert.match(html, /Yogurt AI 全景导出/)
  assert.match(html, /data:image\/png;base64/)
  assert.match(html, /核心循环/)
  assert.match(html, /focusItem\(data\.items/)
  assert.equal(html.includes('</script><script>window.bad=true</script>'), false)
  assert.equal(html.includes('window.bad=true'), true)
})

test('PowerPoint export creates a valid multi-slide pptx package', async () => {
  const result = await buildCanvasPptxBase64({
    title: '怎么让游戏变得更好玩',
    exportedAt: '2026-08-11T03:04:05.000Z',
    overview: { dataUrl: ONE_PIXEL_PNG, width: 1200, height: 800 },
    sections: [{
      shapeId: 'shape:loop',
      type: '卡片',
      title: '核心循环',
      text: '目标 → 行动 → 反馈 → 成长',
      imageDataUrl: ONE_PIXEL_PNG,
      imageWidth: 600,
      imageHeight: 400
    }]
  })
  const buffer = Buffer.from(result.base64, 'base64')

  assert.equal(result.slideCount, 3)
  assert.equal(result.mimeType, 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
  assert.deepEqual([...buffer.subarray(0, 2)], [0x50, 0x4b])
  assert.equal(buffer.includes(Buffer.from('ppt/presentation.xml')), true)
  assert.equal(buffer.includes(Buffer.from('ppt/slides/slide3.xml')), true)
})
