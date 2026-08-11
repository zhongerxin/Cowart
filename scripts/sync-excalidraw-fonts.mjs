import { readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const packageRoot = path.resolve(process.argv[2] ?? '')
const fontSourceDir = path.join(packageRoot, 'dist', 'prod', 'fonts', 'Xiaolai')
const fontTargetDir = path.join(projectRoot, 'src', 'assets', 'fonts', 'xiaolai')
const expectedTargetParent = path.join(projectRoot, 'src', 'assets', 'fonts')
const manifestTarget = path.join(expectedTargetParent, 'xiaolai-manifest.json')

if (!process.argv[2]) {
  throw new Error('Usage: npm run sync:excalidraw-fonts -- <extracted @excalidraw/excalidraw package>')
}

if (
  path.dirname(fontTargetDir) !== expectedTargetParent ||
  path.basename(fontTargetDir) !== 'xiaolai'
) {
  throw new Error(`Refusing to replace unexpected font directory: ${fontTargetDir}`)
}

const packageJson = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'))
if (packageJson.name !== '@excalidraw/excalidraw') {
  throw new Error(`Expected @excalidraw/excalidraw, received ${packageJson.name ?? 'unknown package'}`)
}

const sourceMapDir = path.join(packageRoot, 'dist', 'dev')
const sourceMapNames = (await readdir(sourceMapDir)).filter((name) => name.endsWith('.js.map'))
let xiaolaiSource = ''

for (const sourceMapName of sourceMapNames) {
  const sourceMap = JSON.parse(await readFile(path.join(sourceMapDir, sourceMapName), 'utf8'))
  const sourceIndex = sourceMap.sources?.findIndex((source) => source.endsWith('/fonts/Xiaolai/index.ts'))
  if (sourceIndex >= 0) {
    xiaolaiSource = sourceMap.sourcesContent?.[sourceIndex] ?? ''
    break
  }
}

if (!xiaolaiSource) {
  throw new Error('Could not locate the official Xiaolai font manifest in Excalidraw source maps')
}

const importedFiles = new Map(
  [...xiaolaiSource.matchAll(/import\s+(_\d+)\s+from\s+"\.\/([^"\n]+\.woff2)";/g)].map(
    ([, variableName, fileName]) => [variableName, fileName]
  )
)
const faces = [...xiaolaiSource.matchAll(
  /uri:\s*(_\d+),\s*descriptors:\s*\{\s*unicodeRange:\s*"([^"]+)"/g
)].map(([, variableName, unicodeRange]) => ({
  file: importedFiles.get(variableName),
  unicodeRange
}))

if (faces.length !== 209 || faces.some(({ file }) => !file)) {
  throw new Error(`Expected 209 complete Xiaolai subsets, found ${faces.length}`)
}

const uniqueFiles = new Set(faces.map(({ file }) => file))
if (uniqueFiles.size !== faces.length) {
  throw new Error('The Xiaolai manifest contains duplicate font subset files')
}

const sourceFiles = new Set(
  (await readdir(fontSourceDir)).filter((name) => name.toLowerCase().endsWith('.woff2'))
)
for (const file of uniqueFiles) {
  if (!sourceFiles.has(file)) {
    throw new Error(`Missing Xiaolai subset in the Excalidraw package: ${file}`)
  }
}

await rm(fontTargetDir, { recursive: true, force: true })

const fontVersion = xiaolaiSource.match(/version:\s*Version\s+([^;\n]+)/)?.[1] ?? 'unknown'
const manifest = {
  sourcePackage: packageJson.name,
  sourceVersion: packageJson.version,
  sourceRepository: packageJson.repository,
  family: 'Xiaolai',
  fontVersion,
  license: 'SIL Open Font License 1.1',
  faces
}

await writeFile(
  manifestTarget,
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8'
)

console.log(
  `Synced the ${faces.length}-subset Xiaolai manifest from ${packageJson.name}@${packageJson.version}`
)
