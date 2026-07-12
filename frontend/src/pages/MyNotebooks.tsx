import { NotebooksPanel } from '../components/NotebooksPanel'

export function MyNotebooks() {
  return (
    <div className="notebooks-page">
      <h2 className="notebooks-page-heading">My Notebooks</h2>
      <NotebooksPanel variant="page" />
    </div>
  )
}
