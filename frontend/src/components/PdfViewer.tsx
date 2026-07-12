import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type MouseEvent } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import { ChevronLeft, ChevronRight, Sparkles, ZoomIn, ZoomOut, ImagePlus, TextSelect } from 'lucide-react'
import type { Highlight, HighlightColor, HighlightRect } from '../api/types'
import { API_ORIGIN } from '../api/client'

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

// Translucent fill for the highlight overlays drawn on the page itself.
const HIGHLIGHT_COLORS: Record<HighlightColor, string> = {
  yellow: 'rgba(255, 214, 0, 0.55)',
  green: 'rgba(22, 199, 94, 0.5)',
  blue: 'rgba(37, 130, 246, 0.5)',
  pink: 'rgba(236, 26, 130, 0.5)',
}

// Solid fill for the toolbar swatches so the color reads clearly against the dark pill.
const SWATCH_COLORS: Record<HighlightColor, string> = {
  yellow: '#FFD600',
  green: '#16C75E',
  blue: '#2582F6',
  pink: '#EC1A82',
}

const MIN_ZOOM = 0.5
const MAX_ZOOM = 3
const ZOOM_STEP = 0.25
// How many pages beyond the current one stay mounted in each direction — a plain
// buffer around `page` rather than a second IntersectionObserver, since `page` is
// already tracked for the toolbar label and updates on every scroll settle.
const RENDER_WINDOW = 3
// Fallback aspect ratio (US Letter/A4-ish) for pages whose native size hasn't been
// measured yet, so early placeholders aren't wildly wrong-sized before load.
const FALLBACK_ASPECT = 792 / 612

interface SelectionToolbarState {
  pageNumber: number
  left: number
  top: number
  quote: string
  rects: HighlightRect[]
}

interface ImageDragState {
  pageNumber: number
  startX: number
  startY: number
  x: number
  y: number
  width: number
  height: number
}

export interface PdfViewerHandle {
  scrollToPage: (page: number) => void
}

function findPageWrapper(node: Node | null): HTMLDivElement | null {
  let el: HTMLElement | null = node instanceof HTMLElement ? node : (node?.parentElement ?? null)
  while (el) {
    if (el.dataset.pageNumber) return el as HTMLDivElement
    el = el.parentElement
  }
  return null
}

export const PdfViewer = forwardRef<
  PdfViewerHandle,
  {
    sourceId: string
    sourceType: 'paper' | 'book'
    page: number
    onPageChange: (page: number) => void
    existingHighlights: Highlight[]
    onHighlight: (highlight: { page: number; color: HighlightColor; rects: HighlightRect[]; quote: string }) => void
    onAskAi: (excerpt: { quote: string; page: number }) => void
    onImageAskAi: (excerpt: { imageDataUrl: string; page: number }) => void
  }
>(function PdfViewer(
  { sourceId, sourceType, page, onPageChange, existingHighlights, onHighlight, onAskAi, onImageAskAi },
  ref,
) {
  const [numPages, setNumPages] = useState<number | null>(null)
  const [toolbar, setToolbar] = useState<SelectionToolbarState | null>(null)
  const [zoom, setZoom] = useState(1)
  const [mode, setMode] = useState<'text' | 'image'>('text')
  const [imageDrag, setImageDrag] = useState<ImageDragState | null>(null)
  const [pageDimensions, setPageDimensions] = useState<Map<number, { width: number; height: number }>>(new Map())
  const scrollRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const dragOriginRef = useRef<{ pageNumber: number; left: number; top: number } | null>(null)

  // Render at a fixed high resolution regardless of the display's actual pixel ratio,
  // so text/figures stay crisp even on standard (non-retina) monitors.
  const devicePixelRatio = useMemo(() => Math.max(window.devicePixelRatio || 1, 2.5), [])

  useImperativeHandle(ref, () => ({ scrollToPage }))

  function clearToolbar() {
    setToolbar(null)
    window.getSelection()?.removeAllRanges()
  }

  // Track which page is most visible while the user scrolls, so the toolbar page
  // label and "current page" stay in sync with a continuous, Chrome-PDF-style view.
  useEffect(() => {
    const root = scrollRef.current
    if (!root || !numPages) return

    const observer = new IntersectionObserver(
      (entries) => {
        let best: { pageNumber: number; ratio: number } | null = null
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const pageNumber = Number((entry.target as HTMLElement).dataset.pageNumber)
          if (!best || entry.intersectionRatio > best.ratio) {
            best = { pageNumber, ratio: entry.intersectionRatio }
          }
        }
        if (best) onPageChange(best.pageNumber)
      },
      { root, threshold: [0.1, 0.25, 0.5, 0.75, 1] },
    )

    pageRefs.current.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numPages])

  function scrollToPage(target: number) {
    if (!numPages) return
    const clamped = Math.min(Math.max(target, 1), numPages)
    pageRefs.current.get(clamped)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function handleDocumentLoad(pdf: { numPages: number; getPage: (n: number) => Promise<{ getViewport: (o: { scale: number }) => { width: number; height: number } }> }) {
    setNumPages(pdf.numPages)
    for (let i = 1; i <= pdf.numPages; i++) {
      pdf.getPage(i).then((p) => {
        const vp = p.getViewport({ scale: 1 })
        setPageDimensions((prev) => {
          const next = new Map(prev)
          next.set(i, { width: vp.width, height: vp.height })
          return next
        })
      })
    }
  }

  function adjustZoom(delta: number) {
    setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round((z + delta) * 100) / 100)))
    clearToolbar()
    setImageDrag(null)
  }

  function placeholderHeight(pageNumber: number): number {
    const dims = pageDimensions.get(pageNumber) ?? pageDimensions.get(1)
    const baseWidth = dims?.width ?? 612
    const baseHeight = dims?.height ?? baseWidth * FALLBACK_ASPECT
    // Approximate the rendered width the same way react-pdf would at this zoom —
    // exact match isn't critical, this only sizes an off-screen placeholder.
    return baseHeight * zoom
  }

  function handleMouseUp() {
    if (mode === 'image') return
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      setToolbar(null)
      return
    }
    const quote = selection.toString().trim()
    if (!quote) {
      setToolbar(null)
      return
    }
    const range = selection.getRangeAt(0)
    const wrapper = findPageWrapper(range.commonAncestorContainer)
    if (!wrapper) {
      setToolbar(null)
      return
    }

    const containerRect = wrapper.getBoundingClientRect()
    // Range.getClientRects() can include a degenerate zero-size rect at a line-wrap
    // boundary — drop those rather than persisting an invisible highlight fragment.
    const clientRects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0)
    const rects: HighlightRect[] = clientRects.map((r) => ({
      x: (r.left - containerRect.left) / containerRect.width,
      y: (r.top - containerRect.top) / containerRect.height,
      width: r.width / containerRect.width,
      height: r.height / containerRect.height,
    }))
    const boundingRect = range.getBoundingClientRect()
    setToolbar({
      pageNumber: Number(wrapper.dataset.pageNumber),
      left: boundingRect.left - containerRect.left + boundingRect.width / 2,
      top: boundingRect.top - containerRect.top,
      quote,
      rects,
    })
  }

  function handleHighlightClick(color: HighlightColor) {
    if (!toolbar) return
    onHighlight({ page: toolbar.pageNumber, color, rects: toolbar.rects, quote: toolbar.quote })
    clearToolbar()
  }

  function handleAskAiClick() {
    if (!toolbar) return
    onAskAi({ quote: toolbar.quote, page: toolbar.pageNumber })
    clearToolbar()
  }

  function handleImageMouseDown(e: MouseEvent<HTMLDivElement>) {
    if (mode !== 'image') return
    const wrapper = findPageWrapper(e.target as Node)
    if (!wrapper) return
    const rect = wrapper.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    dragOriginRef.current = { pageNumber: Number(wrapper.dataset.pageNumber), left: rect.left, top: rect.top }
    setImageDrag({ pageNumber: Number(wrapper.dataset.pageNumber), startX: x, startY: y, x, y, width: 0, height: 0 })
  }

  function handleImageMouseMove(e: MouseEvent<HTMLDivElement>) {
    if (mode !== 'image' || !imageDrag || !dragOriginRef.current) return
    const { left, top } = dragOriginRef.current
    const x = e.clientX - left
    const y = e.clientY - top
    setImageDrag((prev) =>
      prev
        ? {
            ...prev,
            x: Math.min(prev.startX, x),
            y: Math.min(prev.startY, y),
            width: Math.abs(x - prev.startX),
            height: Math.abs(y - prev.startY),
          }
        : prev,
    )
  }

  function handleImageMouseUp() {
    if (mode !== 'image' || !imageDrag) return
    const { pageNumber, x, y, width, height } = imageDrag
    dragOriginRef.current = null
    if (width < 8 || height < 8) {
      setImageDrag(null)
      return
    }
    const wrapper = pageRefs.current.get(pageNumber)
    const canvas = wrapper?.querySelector('canvas') as HTMLCanvasElement | null
    if (!canvas) {
      setImageDrag(null)
      return
    }
    const scaleX = canvas.width / canvas.clientWidth
    const scaleY = canvas.height / canvas.clientHeight
    const crop = document.createElement('canvas')
    crop.width = Math.round(width * scaleX)
    crop.height = Math.round(height * scaleY)
    const ctx = crop.getContext('2d')
    if (ctx) {
      ctx.drawImage(
        canvas,
        x * scaleX,
        y * scaleY,
        width * scaleX,
        height * scaleY,
        0,
        0,
        crop.width,
        crop.height,
      )
      onImageAskAi({ imageDataUrl: crop.toDataURL('image/png'), page: pageNumber })
    }
    setImageDrag(null)
  }

  const pdfUrl =
    sourceType === 'book'
      ? `${API_ORIGIN}/api/books/${sourceId}/pdf`
      : `${API_ORIGIN}/api/references/papers/${sourceId}/pdf`

  return (
    <div className="pdf-viewer">
      <div className="pdf-viewer-toolbar">
        <button className="btn btn-icon-sm" disabled={page <= 1} onClick={() => scrollToPage(page - 1)} title="Previous page">
          <ChevronLeft size={14} />
        </button>
        <span className="pdf-viewer-page-label">
          Page {page}
          {numPages ? ` of ${numPages}` : ''}
        </span>
        <button
          className="btn btn-icon-sm"
          disabled={!numPages || page >= numPages}
          onClick={() => scrollToPage(page + 1)}
          title="Next page"
        >
          <ChevronRight size={14} />
        </button>

        <span className="pdf-viewer-toolbar-divider" />

        <button className="btn btn-icon-sm" disabled={zoom <= MIN_ZOOM} onClick={() => adjustZoom(-ZOOM_STEP)} title="Zoom out">
          <ZoomOut size={14} />
        </button>
        <button
          className="pdf-viewer-zoom-label"
          onClick={() => {
            setZoom(1)
            clearToolbar()
          }}
          title="Reset zoom"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button className="btn btn-icon-sm" disabled={zoom >= MAX_ZOOM} onClick={() => adjustZoom(ZOOM_STEP)} title="Zoom in">
          <ZoomIn size={14} />
        </button>

        <span className="pdf-viewer-toolbar-divider" />

        <button
          className={`btn btn-icon-sm${mode === 'text' ? ' selected' : ''}`}
          onClick={() => {
            setMode('text')
            setImageDrag(null)
          }}
          title="Select text"
          aria-label="Select text"
        >
          <TextSelect size={14} />
        </button>
        <button
          className={`btn btn-icon-sm${mode === 'image' ? ' selected' : ''}`}
          onClick={() => {
            setMode('image')
            clearToolbar()
          }}
          title="Select image region"
          aria-label="Select image region"
        >
          <ImagePlus size={14} />
        </button>
      </div>

      <div className="pdf-viewer-scroll" ref={scrollRef} onScroll={clearToolbar}>
        <Document
          file={pdfUrl}
          onLoadSuccess={handleDocumentLoad}
          loading={<div className="empty-state">Loading PDF...</div>}
          error={<div className="empty-state">Couldn't load this PDF.</div>}
        >
          {numPages &&
            Array.from({ length: numPages }, (_, i) => i + 1).map((pageNumber) => {
              const pageHighlights = existingHighlights.filter((h) => h.page === pageNumber)
              const inRenderWindow = Math.abs(pageNumber - page) <= RENDER_WINDOW
              return (
                <div
                  key={pageNumber}
                  className="pdf-page-container"
                  data-page-number={pageNumber}
                  ref={(el) => {
                    if (el) pageRefs.current.set(pageNumber, el)
                    else pageRefs.current.delete(pageNumber)
                  }}
                  style={!inRenderWindow ? { height: placeholderHeight(pageNumber) } : undefined}
                  onMouseUp={mode === 'image' ? handleImageMouseUp : handleMouseUp}
                  onMouseDown={mode === 'image' ? handleImageMouseDown : undefined}
                  onMouseMove={mode === 'image' ? handleImageMouseMove : undefined}
                >
                  {inRenderWindow ? (
                    <Page pageNumber={pageNumber} scale={zoom} renderAnnotationLayer={false} devicePixelRatio={devicePixelRatio} />
                  ) : null}

                  {pageHighlights.map((h) =>
                    h.rects.map((r, ri) => (
                      <div
                        key={`${h.id}-${ri}`}
                        className="pdf-highlight"
                        style={{
                          left: `${r.x * 100}%`,
                          top: `${r.y * 100}%`,
                          width: `${r.width * 100}%`,
                          height: `${r.height * 100}%`,
                          background: HIGHLIGHT_COLORS[h.color],
                        }}
                      />
                    )),
                  )}

                  {toolbar && toolbar.pageNumber === pageNumber && (
                    <div
                      className="pdf-selection-toolbar"
                      style={{ left: toolbar.left, top: toolbar.top }}
                      onMouseDown={(e) => e.preventDefault()}
                    >
                      {(Object.keys(SWATCH_COLORS) as HighlightColor[]).map((color) => (
                        <button
                          key={color}
                          className="pdf-selection-swatch"
                          style={{ background: SWATCH_COLORS[color] }}
                          title={`Highlight ${color}`}
                          onClick={() => handleHighlightClick(color)}
                        />
                      ))}
                      <button className="pdf-selection-ask-ai" onClick={handleAskAiClick}>
                        <Sparkles size={13} /> Ask AI
                      </button>
                    </div>
                  )}

                  {imageDrag && imageDrag.pageNumber === pageNumber && (
                    <div
                      className="pdf-image-selection-box"
                      style={{ left: imageDrag.x, top: imageDrag.y, width: imageDrag.width, height: imageDrag.height }}
                    />
                  )}
                </div>
              )
            })}
        </Document>
      </div>
    </div>
  )
})
