import { useMemo } from 'react'
import { Col, Row } from 'antd'
import { FiClock, FiUploadCloud } from 'react-icons/fi'
import PdfViewerWithHighlights from './PdfViewerWithHighlights'
import type { PdfExtraction } from '../types/pdf'

type HighlightVariant = 'added' | 'removed'

export type PdfComparisonDoc = {
  label?: string
  file: File | null
  extraction: PdfExtraction | null
  highlights?: Set<number>
  highlightType?: HighlightVariant
}

type SideBySidePdfComparisonProps = {
  oldDoc: PdfComparisonDoc
  newDoc: PdfComparisonDoc
  showPreviews: boolean
}

function DocumentColumn({
  label,
  file,
  extraction,
  highlights,
  highlightType,
  showPreview,
}: {
  label: string
  file: File | null
  extraction: PdfExtraction | null
  highlights: Set<number>
  highlightType: HighlightVariant
  showPreview: boolean
}) {
  const hasFile = Boolean(file)
  const shouldRenderPreview = hasFile && showPreview

  return (
    <section className="comparison-panel">
      <header className="comparison-panel__header">
        <h4>{label}</h4>
      </header>
      {shouldRenderPreview ? (
        <div className="preview-block">
          <div className="pdf-preview">
            <PdfViewerWithHighlights
              file={file}
              extraction={extraction}
              highlights={highlights}
              highlightType={highlightType}
              zoom={1}
            />
          </div>
        </div>
      ) : hasFile ? (
        <div className="preview-block">
          <div className="pdf-preview">
            <div className="pdf-preview-placeholder">
              <FiClock aria-hidden="true" />
              <span>Waiting for diff results before rendering this PDF.</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="preview-block">
          <div className="pdf-preview">
            <div className="pdf-preview-placeholder">
              <FiUploadCloud aria-hidden="true" />
              <span>Upload a PDF to see it rendered here.</span>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function SideBySidePdfComparison({ oldDoc, newDoc, showPreviews }: SideBySidePdfComparisonProps) {
  const emptyHighlights = useMemo(() => new Set<number>(), [])

  return (
    <Row gutter={[24, 24]} justify="space-between" className="upload-row">
      <Col xs={24} lg={12} xl={12}>
        <DocumentColumn
          label={oldDoc.label ?? 'Old Document'}
          file={oldDoc.file}
          extraction={oldDoc.extraction}
          highlights={oldDoc.highlights ?? emptyHighlights}
          highlightType={oldDoc.highlightType ?? 'removed'}
          showPreview={showPreviews}
        />
      </Col>
      <Col xs={24} lg={12} xl={12}>
        <DocumentColumn
          label={newDoc.label ?? 'New Document'}
          file={newDoc.file}
          extraction={newDoc.extraction}
          highlights={newDoc.highlights ?? emptyHighlights}
          highlightType={newDoc.highlightType ?? 'added'}
          showPreview={showPreviews}
        />
      </Col>
    </Row>
  )
}

export default SideBySidePdfComparison
