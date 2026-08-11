const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const COLORS = {
  paper: 'FBFAF7',
  panel: 'FFFFFF',
  ink: '242326',
  muted: '77747D',
  line: 'E6E2DA',
  accent: '6965DB'
}

function clampText(value, limit) {
  const text = String(value ?? '').trim()
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

function containRect(sourceWidth, sourceHeight, target) {
  const width = Math.max(1, Number(sourceWidth) || 1)
  const height = Math.max(1, Number(sourceHeight) || 1)
  const scale = Math.min(target.w / width, target.h / height)
  const w = width * scale
  const h = height * scale
  return {
    x: target.x + (target.w - w) / 2,
    y: target.y + (target.h - h) / 2,
    w,
    h
  }
}

function addSlideChrome(pptx, slide, title, eyebrow, index, total) {
  slide.background = { color: COLORS.paper }
  slide.addText(clampText(eyebrow, 70), {
    x: 0.45,
    y: 0.22,
    w: 8.5,
    h: 0.2,
    color: COLORS.accent,
    fontFace: 'Aptos',
    fontSize: 7.5,
    bold: true,
    charSpacing: 1.3,
    margin: 0
  })
  slide.addText(clampText(title, 120), {
    x: 0.45,
    y: 0.43,
    w: 11.7,
    h: 0.42,
    color: COLORS.ink,
    fontFace: 'Microsoft YaHei',
    fontSize: 20,
    bold: true,
    margin: 0,
    breakLine: false,
    fit: 'shrink'
  })
  slide.addText(`${index} / ${total}`, {
    x: 12.1,
    y: 0.28,
    w: 0.75,
    h: 0.2,
    color: COLORS.muted,
    fontFace: 'Aptos',
    fontSize: 8,
    align: 'right',
    margin: 0
  })
  slide.addShape(pptx.ShapeType.line, {
    x: 0.45,
    y: 0.96,
    w: 12.43,
    h: 0,
    line: { color: COLORS.line, width: 1 }
  })
}

function addContainedImage(slide, image, target) {
  const box = containRect(image.width, image.height, target)
  slide.addImage({ data: image.dataUrl, ...box })
  return box
}

function sectionTitle(section, index) {
  return clampText(section?.title || `${section?.type || '画布内容'} ${index + 1}`, 120)
}

export async function buildCanvasPptxBase64({ title, overview, sections = [], exportedAt }) {
  if (!overview?.dataUrl) throw new Error('Canvas overview image is required.')
  const { default: PptxGenJS } = await import('pptxgenjs')
  const pptx = new PptxGenJS()
  const safeTitle = clampText(title || 'Yogurt AI 画布', 160)
  const totalSlides = sections.length ? sections.length + 2 : 1

  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'Yogurt AI'
  pptx.company = 'Yogurt AI'
  pptx.subject = 'Yogurt AI canvas export'
  pptx.title = safeTitle
  pptx.lang = 'zh-CN'
  pptx.theme = {
    headFontFace: 'Microsoft YaHei',
    bodyFontFace: 'Microsoft YaHei',
    lang: 'zh-CN'
  }

  const overviewSlide = pptx.addSlide()
  addSlideChrome(pptx, overviewSlide, safeTitle, 'YOGURT AI · 画布全景', 1, totalSlides)
  overviewSlide.addShape(pptx.ShapeType.roundRect, {
    x: 0.45,
    y: 1.18,
    w: 12.43,
    h: 5.9,
    rectRadius: 0.08,
    fill: { color: COLORS.panel },
    line: { color: COLORS.line, width: 1 }
  })
  addContainedImage(overviewSlide, overview, { x: 0.7, y: 1.4, w: 11.93, h: 5.45 })
  overviewSlide.addNotes(`Yogurt AI canvas overview\nExported at: ${exportedAt || new Date().toISOString()}\nCanvas items: ${sections.length}`)

  if (sections.length) {
    const outlineSlide = pptx.addSlide()
    addSlideChrome(pptx, outlineSlide, '内容目录', 'YOGURT AI · 可编辑内容', 2, totalSlides)
    const midpoint = Math.ceil(sections.length / 2)
    const columns = [sections.slice(0, midpoint), sections.slice(midpoint)]
    columns.forEach((column, columnIndex) => {
      const lines = column.map((section, index) => {
        const absoluteIndex = columnIndex === 0 ? index : midpoint + index
        return `${String(absoluteIndex + 1).padStart(2, '0')}  ${sectionTitle(section, absoluteIndex)}`
      }).join('\n')
      outlineSlide.addText(lines, {
        x: columnIndex === 0 ? 0.65 : 6.78,
        y: 1.35,
        w: 5.9,
        h: 5.55,
        color: COLORS.ink,
        fontFace: 'Microsoft YaHei',
        fontSize: 15,
        breakLine: false,
        valign: 'top',
        margin: 0.08,
        breakLineOnTextOverflow: false,
        fit: 'shrink',
        paraSpaceAfterPt: 10
      })
    })
    outlineSlide.addNotes(sections.map((section, index) => `${index + 1}. ${sectionTitle(section, index)}\n${section.text || ''}`).join('\n\n'))

    sections.forEach((section, index) => {
      const slide = pptx.addSlide()
      const slideIndex = index + 3
      addSlideChrome(
        pptx,
        slide,
        sectionTitle(section, index),
        `YOGURT AI · ${String(section.type || '画布内容').toUpperCase()}`,
        slideIndex,
        totalSlides
      )

      const bodyText = clampText(section.text || '该对象以画布视觉形式保留，可在 PowerPoint 中移动、缩放或替换。', 6000)
      if (section.imageDataUrl) {
        slide.addShape(pptx.ShapeType.roundRect, {
          x: 0.45,
          y: 1.18,
          w: 7.65,
          h: 5.9,
          rectRadius: 0.08,
          fill: { color: COLORS.panel },
          line: { color: COLORS.line, width: 1 }
        })
        addContainedImage(slide, {
          dataUrl: section.imageDataUrl,
          width: section.imageWidth,
          height: section.imageHeight
        }, { x: 0.7, y: 1.43, w: 7.15, h: 5.4 })
        slide.addText(bodyText, {
          x: 8.42,
          y: 1.3,
          w: 4.35,
          h: 5.65,
          color: COLORS.ink,
          fontFace: 'Microsoft YaHei',
          fontSize: 16,
          valign: 'top',
          margin: 0.12,
          breakLine: false,
          fit: 'shrink',
          paraSpaceAfterPt: 8
        })
      } else {
        slide.addText(bodyText, {
          x: 0.75,
          y: 1.38,
          w: 11.83,
          h: 5.4,
          color: COLORS.ink,
          fontFace: 'Microsoft YaHei',
          fontSize: 20,
          valign: 'top',
          margin: 0.15,
          breakLine: false,
          fit: 'shrink',
          paraSpaceAfterPt: 10
        })
      }
      slide.addNotes(`Canvas shape: ${section.shapeId || 'unknown'}\nType: ${section.type || 'unknown'}\n\n${section.text || ''}`)
    })
  }

  const result = await pptx.write({ outputType: 'base64', compression: true })
  if (typeof result !== 'string' || !result) throw new Error('PowerPoint generation returned no data.')
  return { base64: result, mimeType: PPTX_MIME, slideCount: totalSlides }
}
