import { useEffect, useRef } from 'react'
import { getDocument } from 'pdfjs-dist'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist/types/src/display/api'
import type { PdfExtraction } from '../types/pdf'

type HighlightVariant = 'added' | 'removed'

type PdfViewerWithHighlightsProps = {
  file: File | null
  extraction: PdfExtraction | null
  highlights: Set<number>
  highlightType: HighlightVariant
  zoom: number
}

const PLACEHOLDER_HTML = '<div class="pdf-preview-placeholder">Generating highlights…</div>'

function PdfViewerWithHighlights({
  file,
  extraction,
  highlights,
  highlightType,
  zoom,
}: PdfViewerWithHighlightsProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    container.innerHTML = ''

    if (!file) {
      return
    }

    if (!extraction) {
      container.innerHTML = PLACEHOLDER_HTML
      return
    }

    let cancelled = false
    let pdfInstance: PDFDocumentProxy | null = null
    const activeRenderTasks: RenderTask[] = []

    const renderDocument = async () => {
      try {
        const buffer = await file.arrayBuffer()
        if (cancelled) {
          return
        }

        const pdf = await getDocument({ data: buffer }).promise
        pdfInstance = pdf

        for (let pageIndex = 0; pageIndex < pdf.numPages; pageIndex += 1) {
          if (cancelled) {
            break
          }

          const page = await pdf.getPage(pageIndex + 1)
          const baseViewport = page.getViewport({ scale: 1 })
          const measuredWidth = container.clientWidth
          const fallbackWidth = Math.max(baseViewport.width, 1)
          const availableWidth = measuredWidth > 0 ? measuredWidth : fallbackWidth
          const baseScale = (() => {
            const tentative = availableWidth / baseViewport.width
            if (!Number.isFinite(tentative) || tentative <= 0) {
              return 1
            }
            return Math.min(Math.max(tentative, 0.6), 1.2)
          })()
          const zoomedScale = Math.min(baseScale * zoom, 3)

          const viewport = page.getViewport({ scale: zoomedScale })
          const deviceScale = window.devicePixelRatio || 1
          const renderViewport =
            deviceScale !== 1
              ? page.getViewport({ scale: zoomedScale * deviceScale })
              : viewport

          const pageWrapper = document.createElement('div')
          pageWrapper.className = 'pdf-page'
          pageWrapper.style.width = `${viewport.width}px`
          pageWrapper.style.height = `${viewport.height}px`
          pageWrapper.style.maxWidth = '100%'
          pageWrapper.style.margin = '0 auto'

          const canvas = document.createElement('canvas')
          canvas.width = renderViewport.width
          canvas.height = renderViewport.height
          canvas.style.width = '100%'
          canvas.style.height = '100%'
          canvas.className = 'pdf-canvas'
          pageWrapper.appendChild(canvas)

          const context = canvas.getContext('2d')
          if (context) {
            const renderTask = page.render({
              canvasContext: context,
              viewport: renderViewport,
              canvas,
            })
            activeRenderTasks.push(renderTask)
            await renderTask.promise
          }

          const highlightLayer = document.createElement('div')
          highlightLayer.className = 'pdf-highlight-layer'
          highlightLayer.style.width = '100%'
          highlightLayer.style.height = '100%'

          const pageTokens = extraction
            ? extraction.tokens.filter((token) => token.pageIndex === pageIndex)
            : []

          if (highlights.size > 0 && extraction) {
            pageTokens.forEach((token) => {
              if (!highlights.has(token.absoluteIndex)) {
                return
              }

              const highlight = document.createElement('div')
              highlight.className = `pdf-highlight ${highlightType}`
              const rect = token.rect
              const widthPercent = rect.width * 100
              const heightPercent = rect.height * 100

              if (widthPercent <= 0 || heightPercent <= 0) {
                return
              }

              highlight.style.left = `${rect.x * 100}%`
              highlight.style.top = `${rect.y * 100}%`
              highlight.style.width = `${widthPercent}%`
              highlight.style.height = `${heightPercent}%`

              highlightLayer.appendChild(highlight)
            })
          }

          pageWrapper.appendChild(highlightLayer)
          container.appendChild(pageWrapper)
        }
      } catch (renderError) {
        const errorMessage =
          renderError instanceof Error ? renderError.message : String(renderError)
        const isExpectedCancellation =
          renderError instanceof Error &&
          (renderError.name === 'RenderingCancelledException' ||
            errorMessage.includes('Rendering cancelled') ||
            errorMessage.includes('Transport destroyed'))

        if (isExpectedCancellation) {
          return
        }

        console.error('Unable to render PDF preview with highlights', renderError)
        const messageText = errorMessage || 'Unable to load preview.'
        container.innerHTML = `<div class="pdf-preview-error">${messageText}</div>`
      } finally {
        if (pdfInstance) {
          try {
            pdfInstance.destroy()
          } catch (destroyError) {
            console.warn('Failed to destroy PDF instance', destroyError)
          }
          pdfInstance = null
        }
      }
    }

    renderDocument()

    return () => {
      cancelled = true
      activeRenderTasks.forEach((task) => {
        try {
          task.cancel()
        } catch (taskError) {
          console.warn('Failed to cancel render task', taskError)
        }
      })
      container.innerHTML = ''
      if (pdfInstance) {
        try {
          pdfInstance.destroy()
        } catch (destroyError) {
          console.warn('Failed to destroy PDF instance', destroyError)
        }
      }
    }
  }, [file, extraction, highlights, highlightType, zoom])

  return <div className="pdf-preview-renderer" ref={containerRef} />
}

export default PdfViewerWithHighlights
