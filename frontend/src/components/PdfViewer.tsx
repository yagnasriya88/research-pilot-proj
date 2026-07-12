import { useEffect, useMemo, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import { ChevronLeft, ChevronRight, Sparkles } from 'lucide-react'
import type { Highlight, HighlightColor, HighlightRect } from '../api/types'

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

interface SelectionToolbarState {
  pageNumber: number
  left: number
  top: number
  quote: string
  rects: HighlightRect[]
}

function findPageWrapper(node: Node | null): HTMLDivElement | null {
  let el: HTMLElement | null = node instanceof HTMLElement ? node : (node?.parentElement ?? null)
  while (el) {
    if (el.dataset.pageNumber) return el as HTMLDivElement
    el = el.parentElement
  }
  return null
}

export function PdfViewer({
  paperId,
  page,
  onPageChange,
  existingHighlights,
  onHighlight,
  onAskAi,
}: {
  paperId: string
  page: number
  onPageChange: (page: number) => void
  existingHighlights: Highlight[]
  onHighlight: (highlight: { page: number; color: HighlightColor; rects: HighlightRect[]; quote: string }) => void
  onAskAi: (excerpt: { quote: string; page: number }) => void
}) {
  const [numPages, setNumPages] = useState<number | null>(null)
  const [toolbar, setToolbar] = useState<SelectionToolbarState | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map())

  // Render at a fixed high resolution regardless of the display's actual pixel ratio,
  // so text/figures stay crisp even on standard (non-retina) monitors.
  const devicePixelRatio = useMemo(() => Math.max(window.devicePixelRatio || 1, 2.5), [])

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

  function handleMouseUp() {
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
      </div>

      <div className="pdf-viewer-scroll" ref={scrollRef} onScroll={clearToolbar}>
        <Document
          file={`/api/references/papers/${paperId}/pdf`}
          onLoadSuccess={({ numPages: n }) => setNumPages(n)}
          loading={<div className="empty-state">Loading PDF...</div>}
          error={<div className="empty-state">Couldn't load this PDF.</div>}
        >
          {numPages &&
            Array.from({ length: numPages }, (_, i) => i + 1).map((pageNumber) => {
              const pageHighlights = existingHighlights.filter((h) => h.page === pageNumber)
              return (
                <div
                  key={pageNumber}
                  className="pdf-page-container"
                  data-page-number={pageNumber}
                  ref={(el) => {
                    if (el) pageRefs.current.set(pageNumber, el)
                    else pageRefs.current.delete(pageNumber)
                  }}
                  onMouseUp={handleMouseUp}
                >
                  <Page pageNumber={pageNumber} renderAnnotationLayer={false} devicePixelRatio={devicePixelRatio} />

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
                </div>
              )
            })}
        </Document>
      </div>
    </div>
  )
}
