import { DEFAULT_THEME } from 'tldraw'
import excalifontCyrillicUrl from './assets/fonts/Excalifont-Regular-b9dcf9d2e50a1eaf42fc664b50a3fd0d.woff2?url'
import excalifontCyrillicExtendedUrl from './assets/fonts/Excalifont-Regular-349fac6ca4700ffec595a7150a0d1e1d.woff2?url'
import excalifontDiacriticsUrl from './assets/fonts/Excalifont-Regular-623ccf21b21ef6b3a0d87738f77eb071.woff2?url'
import excalifontGreekUrl from './assets/fonts/Excalifont-Regular-41b173a47b57366892116a575a43e2b6.woff2?url'
import excalifontLatinUrl from './assets/fonts/Excalifont-Regular-a88b72a24fb54c9f94e3b5fdaa7481c9.woff2?url'
import excalifontLatinExtendedUrl from './assets/fonts/Excalifont-Regular-be310b9bcd4f1a43f571c46df7809174.woff2?url'
import excalifontMarksUrl from './assets/fonts/Excalifont-Regular-3f2c5db56cc93c5a6873b1361d730c16.woff2?url'
import xiaolaiManifest from './assets/fonts/xiaolai-manifest.json'

const COWART_DRAW_FONT_FAMILY =
  '"Excalifont", "Xiaolai", "LXGW WenKai", "霞鹜文楷", "Kaiti SC", STKaiti, KaiTi, "Microsoft YaHei", cursive'
const COWART_SANS_FONT_FAMILY =
  '"Assistant", "PingFang SC", "Microsoft YaHei", ui-sans-serif, system-ui, sans-serif'
const COWART_CANVAS_BACKGROUND = '#fffdf8'
const COWART_XIAOLAI_STYLE_ID = 'cowart-excalidraw-xiaolai-font-faces'
const COWART_XIAOLAI_CDN_ROOT =
  `https://cdn.jsdelivr.net/npm/${xiaolaiManifest.sourcePackage}@${xiaolaiManifest.sourceVersion}` +
  '/dist/prod/fonts/Xiaolai'

function excalifontFace(url, unicodeRange) {
  return {
    family: 'Excalifont',
    src: { url, format: 'woff2' },
    style: 'normal',
    weight: 'normal',
    unicodeRange
  }
}

const excalifontFaces = [
  excalifontFace(
    excalifontLatinUrl,
    'U+20-7e,U+a0-a3,U+a5-a6,U+a8-ab,U+ad-b1,U+b4,U+b6-b8,U+ba-ff,U+131,U+152-153,U+2bc,U+2c6,U+2da,U+2dc,U+304,U+308,U+2013-2014,U+2018-201a,U+201c-201e,U+2020,U+2022,U+2024-2026,U+2030,U+2039-203a,U+20ac,U+2122,U+2212'
  ),
  excalifontFace(
    excalifontLatinExtendedUrl,
    'U+100-130,U+132-137,U+139-149,U+14c-151,U+154-17e,U+192,U+1fc-1ff,U+218-21b,U+237,U+1e80-1e85,U+1ef2-1ef3,U+2113'
  ),
  excalifontFace(excalifontCyrillicUrl, 'U+400-45f,U+490-491,U+2116'),
  excalifontFace(
    excalifontGreekUrl,
    'U+37e,U+384-38a,U+38c,U+38e-393,U+395-3a1,U+3a3-3a8,U+3aa-3cf,U+3d7'
  ),
  excalifontFace(
    excalifontMarksUrl,
    'U+2c7,U+2d8-2d9,U+2db,U+2dd,U+302,U+306-307,U+30a-30c,U+326-328,U+212e,U+2211,U+fb01-fb02'
  ),
  excalifontFace(
    excalifontCyrillicExtendedUrl,
    'U+462-463,U+472-475,U+4d8-4d9,U+4e2-4e3,U+4e6-4e9,U+4ee-4ef'
  ),
  excalifontFace(excalifontDiacriticsUrl, 'U+300-301,U+303')
]

export function installCowartHandDrawnFontFaces(targetDocument = globalThis.document) {
  if (!targetDocument?.head) return false
  if (targetDocument.getElementById(COWART_XIAOLAI_STYLE_ID)) return true

  const fontFaceRules = xiaolaiManifest.faces.map(({ file, unicodeRange }) => {
    const url = `${COWART_XIAOLAI_CDN_ROOT}/${encodeURIComponent(file)}`
    return `@font-face{font-family:"Xiaolai";src:url(${JSON.stringify(url)}) format("woff2");font-display:swap;font-style:normal;font-weight:400;unicode-range:${unicodeRange};}`
  })

  const style = targetDocument.createElement('style')
  style.id = COWART_XIAOLAI_STYLE_ID
  style.dataset.source = `${xiaolaiManifest.sourcePackage}@${xiaolaiManifest.sourceVersion}`
  style.textContent = fontFaceRules.join('\n')
  targetDocument.head.append(style)
  return true
}

export const cowartTldrawThemes = {
  default: {
    ...DEFAULT_THEME,
    strokeWidth: 1.5,
    colors: {
      ...DEFAULT_THEME.colors,
      light: {
        ...DEFAULT_THEME.colors.light,
        text: '#303030',
        background: COWART_CANVAS_BACKGROUND,
        negativeSpace: COWART_CANVAS_BACKGROUND,
        solid: COWART_CANVAS_BACKGROUND,
        black: {
          ...DEFAULT_THEME.colors.light.black,
          solid: '#343434',
          fill: '#343434',
          linedFill: '#454545',
          frameFill: COWART_CANVAS_BACKGROUND
        }
      }
    },
    fonts: {
      ...DEFAULT_THEME.fonts,
      draw: {
        ...DEFAULT_THEME.fonts.draw,
        faces: excalifontFaces,
        fontFamily: COWART_DRAW_FONT_FAMILY
      },
      sans: {
        ...DEFAULT_THEME.fonts.sans,
        faces: undefined,
        fontFamily: COWART_SANS_FONT_FAMILY
      }
    }
  }
}
