const DEFAULT_EXPORT_TITLE = 'Yogurt AI 画布'

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function jsonForInlineScript(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')
}

function normalizedTitle(value) {
  const title = String(value ?? '').replace(/\s+/g, ' ').trim()
  return title || DEFAULT_EXPORT_TITLE
}

function itemLabel(item, index) {
  const title = String(item?.title ?? '').trim()
  return title || `${String(item?.type || '内容')} ${index + 1}`
}

function itemSnippet(item) {
  const text = String(item?.text ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return '画布视觉对象'
  return text.length > 110 ? `${text.slice(0, 109)}…` : text
}

export function canvasExportFileName(format, exportedAt = new Date()) {
  const date = exportedAt instanceof Date ? exportedAt : new Date(exportedAt)
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date
  const stamp = safeDate
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
  const extension = format === 'pptx' ? 'pptx' : 'html'
  return `yogurt-ai-canvas-${stamp}.${extension}`
}

export function buildCanvasHtmlDocument({ title, overview, items = [], exportedAt }) {
  if (!overview?.dataUrl) throw new Error('Canvas overview image is required.')

  const safeTitle = normalizedTitle(title)
  const canvasBounds = overview.bounds ?? {
    x: 0,
    y: 0,
    w: Number(overview.displayWidth) || Number(overview.width) || 1,
    h: Number(overview.displayHeight) || Number(overview.height) || 1
  }
  const exportTime = exportedAt || new Date().toISOString()
  const outlineHtml = items.length
    ? items.map((item, index) => `
        <button class="outline-item" data-item-index="${index}" type="button">
          <span class="outline-index">${String(index + 1).padStart(2, '0')}</span>
          <span class="outline-copy">
            <strong>${escapeHtml(itemLabel(item, index))}</strong>
            <small>${escapeHtml(itemSnippet(item))}</small>
          </span>
        </button>`).join('')
    : '<p class="outline-empty">当前画布没有可列出的文字内容。</p>'
  const safeData = jsonForInlineScript({
    bounds: canvasBounds,
    imageWidth: Number(overview.width) || 1,
    imageHeight: Number(overview.height) || 1,
    items
  })
  const safeImageUrl = jsonForInlineScript(overview.dataUrl)

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(safeTitle)}</title>
  <style>
    :root{color-scheme:light;--paper:#fbfaf7;--panel:#fff;--ink:#242326;--muted:#77747d;--line:#e6e2da;--accent:#6965db;--accent-soft:#eeedff}
    *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:var(--paper);color:var(--ink);font-family:"Assistant","PingFang SC","Microsoft YaHei",system-ui,sans-serif}
    body{display:grid;grid-template-rows:58px minmax(0,1fr)}button{font:inherit}
    header{display:flex;z-index:3;align-items:center;gap:16px;padding:0 18px;background:#ffffffed;border-bottom:1px solid var(--line);backdrop-filter:blur(14px)}
    .brand{display:grid;width:32px;height:32px;place-items:center;color:#fff;background:var(--accent);border-radius:10px;font-weight:800}.heading{min-width:0}.heading h1{overflow:hidden;margin:0;font-size:15px;text-overflow:ellipsis;white-space:nowrap}.heading p{margin:2px 0 0;color:var(--muted);font-size:11px}
    .tools{display:flex;margin-left:auto;gap:6px}.tools button{min-width:34px;height:34px;padding:0 10px;color:var(--ink);background:var(--panel);border:1px solid var(--line);border-radius:9px;cursor:pointer}.tools button:hover{background:var(--accent-soft);border-color:#c9c6ff}
    .workspace{display:grid;min-height:0;grid-template-columns:280px minmax(0,1fr)}aside{z-index:2;overflow:auto;padding:14px 10px 24px;background:#ffffffc9;border-right:1px solid var(--line)}
    aside h2{margin:4px 8px 10px;font-size:12px}.outline-item{display:grid;width:100%;padding:9px 8px;grid-template-columns:28px minmax(0,1fr);gap:7px;text-align:left;color:inherit;background:transparent;border:0;border-radius:9px;cursor:pointer}.outline-item:hover,.outline-item:focus-visible{background:var(--accent-soft);outline:0}.outline-index{padding-top:2px;color:var(--accent);font-size:10px;font-weight:700}.outline-copy{display:flex;min-width:0;flex-direction:column;gap:2px}.outline-copy strong{overflow:hidden;font-size:12px;text-overflow:ellipsis;white-space:nowrap}.outline-copy small{display:-webkit-box;overflow:hidden;color:var(--muted);font-size:10px;line-height:1.35;-webkit-box-orient:vertical;-webkit-line-clamp:2}.outline-empty{margin:8px;color:var(--muted);font-size:11px;line-height:1.6}
    .stage{position:relative;min-width:0;min-height:0;overflow:hidden;touch-action:none;cursor:grab;background-color:var(--paper);background-image:radial-gradient(#d8d4cc 0.7px,transparent 0.7px);background-size:18px 18px}.stage.is-panning{cursor:grabbing}.surface{position:absolute;top:0;left:0;transform-origin:0 0;will-change:transform}.surface img{display:block;max-width:none;background:#fff;box-shadow:0 12px 38px #2d2a241c}.focus-ring{position:absolute;display:none;pointer-events:none;border:3px solid var(--accent);border-radius:8px;box-shadow:0 0 0 5px #6965db26}
    .hint{position:absolute;right:12px;bottom:12px;padding:7px 10px;color:var(--muted);background:#fffffff0;border:1px solid var(--line);border-radius:9px;font-size:10px;box-shadow:0 4px 18px #2d2a2412}
    @media(max-width:760px){body{grid-template-rows:54px minmax(0,1fr)}.workspace{grid-template-columns:1fr}aside{display:none}.heading p{display:none}.hint{display:none}}
  </style>
</head>
<body>
  <header>
    <div class="brand" aria-hidden="true">Y</div>
    <div class="heading"><h1>${escapeHtml(safeTitle)}</h1><p>Yogurt AI 全景导出 · ${escapeHtml(exportTime)} · ${items.length} 项内容</p></div>
    <div class="tools" aria-label="画布缩放">
      <button id="zoom-out" aria-label="缩小" title="缩小">−</button>
      <button id="fit" aria-label="适应窗口" title="适应窗口">适应</button>
      <button id="zoom-in" aria-label="放大" title="放大">＋</button>
    </div>
  </header>
  <div class="workspace">
    <aside aria-label="内容目录"><h2>画布内容</h2>${outlineHtml}</aside>
    <main class="stage" id="stage" aria-label="Yogurt AI 画布全景">
      <div class="surface" id="surface"><img id="canvas-image" alt="${escapeHtml(safeTitle)} 全景"><div class="focus-ring" id="focus-ring"></div></div>
      <div class="hint">拖拽平移 · 滚轮缩放 · 点击左侧目录定位</div>
    </main>
  </div>
  <script>
    (()=>{
      const data=${safeData};
      const image=document.getElementById('canvas-image'),stage=document.getElementById('stage'),surface=document.getElementById('surface'),ring=document.getElementById('focus-ring');
      let scale=1,offsetX=0,offsetY=0,drag=null;
      image.src=${safeImageUrl};
      image.width=data.imageWidth;image.height=data.imageHeight;
      function render(){surface.style.transform='translate('+offsetX+'px,'+offsetY+'px) scale('+scale+')'}
      function fit(){const pad=36;scale=Math.min((stage.clientWidth-pad*2)/data.imageWidth,(stage.clientHeight-pad*2)/data.imageHeight,1.5);scale=Math.max(.05,scale);offsetX=(stage.clientWidth-data.imageWidth*scale)/2;offsetY=(stage.clientHeight-data.imageHeight*scale)/2;ring.style.display='none';render()}
      function zoomAt(next,cx=stage.clientWidth/2,cy=stage.clientHeight/2){next=Math.max(.05,Math.min(8,next));const px=(cx-offsetX)/scale,py=(cy-offsetY)/scale;scale=next;offsetX=cx-px*scale;offsetY=cy-py*scale;render()}
      function focusItem(item){if(!item?.bounds)return;const b=item.bounds,root=data.bounds;const x=(b.x-root.x)/root.w*data.imageWidth,y=(b.y-root.y)/root.h*data.imageHeight,w=b.w/root.w*data.imageWidth,h=b.h/root.h*data.imageHeight;ring.style.display='block';ring.style.left=x+'px';ring.style.top=y+'px';ring.style.width=Math.max(4,w)+'px';ring.style.height=Math.max(4,h)+'px';const target=Math.max(.08,Math.min(3,Math.min((stage.clientWidth-100)/Math.max(w,1),(stage.clientHeight-100)/Math.max(h,1))));scale=target;offsetX=stage.clientWidth/2-(x+w/2)*scale;offsetY=stage.clientHeight/2-(y+h/2)*scale;render()}
      document.getElementById('zoom-in').onclick=()=>zoomAt(scale*1.2);document.getElementById('zoom-out').onclick=()=>zoomAt(scale/1.2);document.getElementById('fit').onclick=fit;
      document.querySelectorAll('[data-item-index]').forEach(button=>button.onclick=()=>focusItem(data.items[Number(button.dataset.itemIndex)]));
      stage.addEventListener('wheel',event=>{event.preventDefault();const rect=stage.getBoundingClientRect();zoomAt(scale*Math.exp(-event.deltaY*.0015),event.clientX-rect.left,event.clientY-rect.top)},{passive:false});
      stage.addEventListener('pointerdown',event=>{if(event.button!==0)return;drag={x:event.clientX,y:event.clientY,ox:offsetX,oy:offsetY};stage.setPointerCapture(event.pointerId);stage.classList.add('is-panning')});
      stage.addEventListener('pointermove',event=>{if(!drag)return;offsetX=drag.ox+event.clientX-drag.x;offsetY=drag.oy+event.clientY-drag.y;render()});
      function stop(){drag=null;stage.classList.remove('is-panning')}stage.addEventListener('pointerup',stop);stage.addEventListener('pointercancel',stop);
      image.addEventListener('load',fit,{once:true});addEventListener('resize',fit);if(image.complete)fit();
    })();
  </script>
</body>
</html>`
}
