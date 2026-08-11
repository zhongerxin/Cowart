export function getCowartSelection(editor) {
  return editor.getSelectedShapeIds().map((id) => {
    const shape = editor.getShape(id)
    const asset = shape?.props?.assetId ? editor.getAsset(shape.props.assetId) : null

    return {
      id,
      type: shape?.type ?? null,
      parentId: shape?.parentId ?? null,
      x: shape?.x ?? null,
      y: shape?.y ?? null,
      rotation: shape?.rotation ?? null,
      meta: shape?.meta ?? null,
      isAiImageHolder: shape?.meta?.cowartAiImageHolder === true,
      isAiDraftHolder: shape?.meta?.cowartAiDraftHolder === true,
      isAiSlides: shape?.meta?.cowartAiSlides === true,
      isHtmlDraft:
        shape?.type === 'embed' &&
        (shape?.meta?.cowartHtmlDraft === true ||
          /^http:\/\/cowart\.local\//i.test(shape?.props?.url ?? '') ||
          /^data:text\/html(?:;[^,]*)?,/i.test(shape?.props?.url ?? '')),
      props: shape?.props ?? null,
      asset: asset
        ? {
            id: asset.id,
            type: asset.type,
            name: asset.props?.name ?? null,
            src: asset.props?.src ?? null,
            w: asset.props?.w ?? null,
            h: asset.props?.h ?? null,
            mimeType: asset.props?.mimeType ?? null,
            fileSize: asset.props?.fileSize ?? null
          }
        : null
    }
  })
}

export function getCowartSelectionSnapshot(editor) {
  return {
    selectedShapes: getCowartSelection(editor)
  }
}
