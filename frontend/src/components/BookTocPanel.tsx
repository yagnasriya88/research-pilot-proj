import { useMemo, useState } from 'react'
import { ChevronRight, ChevronDown, PanelLeftClose } from 'lucide-react'
import type { TocEntry } from '../api/types'

interface TocNode extends TocEntry {
  children: TocNode[]
  endPage: number
}

// Groups a flat, level-tagged outline (as produced by the PDF's own embedded ToC)
// into a nested tree via a simple stack-based grouping — standard technique for this
// shape of data (parent = nearest preceding entry with a lower level).
function buildTree(entries: TocEntry[]): TocNode[] {
  const roots: TocNode[] = []
  const stack: TocNode[] = []

  entries.forEach((entry, i) => {
    const nextPage = entries[i + 1]?.page ?? Infinity
    const node: TocNode = { ...entry, children: [], endPage: nextPage }
    while (stack.length && stack[stack.length - 1].level >= entry.level) stack.pop()
    if (stack.length) {
      stack[stack.length - 1].children.push(node)
    } else {
      roots.push(node)
    }
    stack.push(node)
  })

  return roots
}

// `endPage` (the next entry's page, in flat document order — set by `buildTree`) is
// already correct for containment regardless of nesting depth: a node's content runs
// until the very next ToC entry starts, whether that entry is a child, a sibling, or
// an ancestor's next sibling.
function containsPage(node: TocNode, page: number): boolean {
  return page >= node.page && page < node.endPage
}

function subtreeContainsPage(node: TocNode, page: number): boolean {
  return containsPage(node, page) || node.children.some((c) => subtreeContainsPage(c, page))
}

function TocNodeRow({
  node,
  currentPage,
  onNavigate,
}: {
  node: TocNode
  currentPage: number
  onNavigate: (page: number) => void
}) {
  const active = containsPage(node, currentPage)
  const [open, setOpen] = useState(() => subtreeContainsPage(node, currentPage))

  return (
    <div className="toc-node">
      <div className={`toc-row${active ? ' active' : ''}`}>
        {node.children.length > 0 ? (
          <button className="toc-toggle" onClick={() => setOpen((o) => !o)} aria-label={open ? 'Collapse' : 'Expand'}>
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        ) : (
          <span className="toc-toggle-spacer" />
        )}
        <button className="toc-title" onClick={() => onNavigate(node.page)}>
          {node.title}
        </button>
      </div>
      {open && node.children.length > 0 && (
        <div className="toc-children">
          {node.children.map((child, i) => (
            <TocNodeRow key={`${child.title}-${i}`} node={child} currentPage={currentPage} onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </div>
  )
}

export function BookTocPanel({
  tableOfContents,
  currentPage,
  onNavigate,
  onCollapse,
}: {
  tableOfContents: TocEntry[]
  currentPage: number
  onNavigate: (page: number) => void
  onCollapse?: () => void
}) {
  const tree = useMemo(() => buildTree(tableOfContents), [tableOfContents])

  if (tree.length === 0) return null

  return (
    <div className="book-toc-panel">
      <div className="book-toc-header">
        <span>Table of Contents</span>
        {onCollapse && (
          <button
            type="button"
            className="btn btn-icon btn-icon-sm book-toc-collapse"
            onClick={onCollapse}
            aria-label="Collapse table of contents"
            title="Collapse table of contents"
          >
            <PanelLeftClose size={15} />
          </button>
        )}
      </div>
      <div className="book-toc-list">
        {tree.map((node, i) => (
          <TocNodeRow key={`${node.title}-${i}`} node={node} currentPage={currentPage} onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  )
}
