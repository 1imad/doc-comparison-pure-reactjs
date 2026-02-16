import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Typography,
  Upload,
  Card,
  Row,
  Col,
  message,
  Alert,
  Spin,
  Space,
  Tag,
} from 'antd'
import { InboxOutlined } from '@ant-design/icons'
import type { UploadProps } from 'antd'
import type { UploadFile } from 'antd/es/upload/interface'
import {
  diffArrays,
  diffLines,
  diffSentences,
  diffWords,
  type Change,
} from 'diff'
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import type { PDFDocumentProxy, TextItem } from 'pdfjs-dist/types/src/display/api'
import pdfWorker from 'pdfjs-dist/build/pdf.worker?url'
import './App.css'

const { Title, Text } = Typography
const { Dragger } = Upload

GlobalWorkerOptions.workerSrc = pdfWorker

const WORD_DIFF_THRESHOLD = 200000
const PARAGRAPH_DIFF_THRESHOLD = 900000
const ABSOLUTE_DIFF_LIMIT = 2600000

type DiffMode = 'word' | 'paragraph' | 'sentence'

type NormalizedRect = {
  x: number
  y: number
  width: number
  height: number
}

type PdfToken = {
  text: string
  pageIndex: number
  itemIndex: number
  absoluteIndex: number
  rect: NormalizedRect
}

type PdfExtraction = {
  tokens: PdfToken[]
  fullText: string
  pageMetrics: { width: number; height: number }[]
}

type DiffToken = PdfToken

type DiffWorkerRequest = {
  jobId: number
  text1: string
  text2: string
  tokens1: DiffToken[]
  tokens2: DiffToken[]
  mode: DiffMode
}

type DiffWorkerPayload = {
  textDiff: Change[]
  removedTokenIndexes: number[]
  addedTokenIndexes: number[]
}

type DiffWorkerResponse =
  | { type: 'result'; jobId: number; payload: DiffWorkerPayload }
  | { type: 'error'; jobId: number; payload: string }

type DiffSegmentType = 'unchanged' | 'added' | 'removed'

type DiffSegment = {
  value: string
  type: DiffSegmentType
}

async function extractTextFromPdf(file: File): Promise<PdfExtraction> {
  const data = await file.arrayBuffer()
  const pdf = await getDocument({ data }).promise

  try {
    const tokens: PdfToken[] = []
    const textParts: string[] = []
    const pageMetrics: { width: number; height: number }[] = []
    let absoluteIndex = 0

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      try {
        const page = await pdf.getPage(pageNumber)
        const viewport = page.getViewport({ scale: 1 })
        pageMetrics.push({ width: viewport.width, height: viewport.height })

        const textContent = await page.getTextContent({
          disableCombineTextItems: true,
        } as Parameters<typeof page.getTextContent>[0])

        let itemIndex = 0
        textContent.items.forEach((item) => {
          if (!('str' in item)) {
            return
          }

          const textItem = item as TextItem
          const value = textItem.str.replace(/\s+/g, ' ').trim()
          if (!value) {
            itemIndex += 1
            return
          }

          const itemWidth =
            textItem.width || Math.sqrt(textItem.transform[0] ** 2 + textItem.transform[1] ** 2)
          const rawHeight =
            textItem.height && textItem.height > 0
              ? textItem.height
              : Math.sqrt(textItem.transform[2] ** 2 + textItem.transform[3] ** 2)

          const rectPoints = viewport.convertToViewportRectangle([
            textItem.transform[4],
            textItem.transform[5],
            textItem.transform[4] + itemWidth,
            textItem.transform[5] + rawHeight,
          ])

          const [rawX1, rawY1, rawX2, rawY2] = rectPoints
          const minX = Math.min(rawX1, rawX2)
          const minY = Math.min(rawY1, rawY2)
          const maxX = Math.max(rawX1, rawX2)
          const maxY = Math.max(rawY1, rawY2)
          const width = maxX - minX
          const height = maxY - minY

          if (width <= 0 || height <= 0) {
            itemIndex += 1
            return
          }

          const clampedMinX = Math.max(0, Math.min(viewport.width, minX))
          const clampedMinY = Math.max(0, Math.min(viewport.height, minY))
          const clampedMaxX = Math.max(clampedMinX, Math.min(viewport.width, maxX))
          const clampedMaxY = Math.max(clampedMinY, Math.min(viewport.height, maxY))

          const normalizedRect: NormalizedRect = {
            x: viewport.width === 0 ? 0 : clampedMinX / viewport.width,
            y: viewport.height === 0 ? 0 : clampedMinY / viewport.height,
            width:
              viewport.width === 0
                ? 0
                : (clampedMaxX - clampedMinX) / viewport.width,
            height:
              viewport.height === 0
                ? 0
                : (clampedMaxY - clampedMinY) / viewport.height,
          }

          if (normalizedRect.width <= 0 || normalizedRect.height <= 0) {
            itemIndex += 1
            return
          }

          tokens.push({
            text: value,
            pageIndex: pageNumber - 1,
            itemIndex,
            absoluteIndex,
            rect: normalizedRect,
          })
          textParts.push(value)
          absoluteIndex += 1
          itemIndex += 1
        })
      } catch (pageError) {
        console.warn(`Unable to extract page ${pageNumber}`, pageError)
      }
    }

    if (textParts.length === 0) {
      throw new Error(
        'No searchable text found. The PDF may be scanned, encrypted, or corrupted.',
      )
    }

    return {
      tokens,
      fullText: textParts.join(' '),
      pageMetrics,
    }
  } finally {
    pdf.destroy()
  }
}

type PdfViewerWithHighlightsProps = {
  file: File | null
  extraction: PdfExtraction | null
  highlights: Set<number>
  highlightType: 'added' | 'removed'
}

function PdfViewerWithHighlights({
  file,
  extraction,
  highlights,
  highlightType,
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
      container.innerHTML = '<div class="pdf-preview-placeholder">Generating highlights…</div>'
      return
    }

    let cancelled = false
    let pdfInstance: PDFDocumentProxy | null = null

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
          const scale = 1.2
          const viewport = page.getViewport({ scale })

          const pageWrapper = document.createElement('div')
          pageWrapper.className = 'pdf-page'
          pageWrapper.style.width = `${viewport.width}px`
          pageWrapper.style.height = `${viewport.height}px`

          const canvas = document.createElement('canvas')
          canvas.width = viewport.width
          canvas.height = viewport.height
          canvas.className = 'pdf-canvas'
          pageWrapper.appendChild(canvas)

          const context = canvas.getContext('2d')
          if (context) {
            const renderTask = page.render({
              canvasContext: context,
              viewport,
              canvas,
            })
            await renderTask.promise
          }

          const highlightLayer = document.createElement('div')
          highlightLayer.className = 'pdf-highlight-layer'
          highlightLayer.style.width = `${viewport.width}px`
          highlightLayer.style.height = `${viewport.height}px`

          const pageTokens = extraction
            ? extraction.tokens.filter((token) => token.pageIndex === pageIndex)
            : []

          if (highlights.size > 0 && extraction) {
            const width = viewport.width
            const height = viewport.height

            pageTokens.forEach((token) => {
              if (!highlights.has(token.absoluteIndex)) {
                return
              }

              const highlight = document.createElement('div')
              highlight.className = `pdf-highlight ${highlightType}`
              const rect = token.rect
              const left = rect.x * width
              const top = rect.y * height
              const boxWidth = rect.width * width
              const boxHeight = rect.height * height

              if (boxWidth <= 0 || boxHeight <= 0) {
                return
              }

              highlight.style.left = `${left}px`
              highlight.style.top = `${top}px`
              highlight.style.width = `${boxWidth}px`
              highlight.style.height = `${boxHeight}px`

              highlightLayer.appendChild(highlight)
            })
          }

          pageWrapper.appendChild(highlightLayer)
          container.appendChild(pageWrapper)
        }
      } catch (renderError) {
        console.error('Unable to render PDF preview with highlights', renderError)
        const message =
          renderError instanceof Error && renderError.message
            ? renderError.message
            : 'Unable to load preview.'
        container.innerHTML = `<div class="pdf-preview-error">${message}</div>`
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
      container.innerHTML = ''
      if (pdfInstance) {
        try {
          pdfInstance.destroy()
        } catch (destroyError) {
          console.warn('Failed to destroy PDF instance', destroyError)
        }
        pdfInstance = null
      }
    }
  }, [file, extraction, highlights, highlightType])

  return <div className="pdf-preview-renderer" ref={containerRef} />
}

function App() {
  const [pdf1, setPdf1] = useState<File | null>(null)
  const [pdf2, setPdf2] = useState<File | null>(null)
  const [pdf1Extraction, setPdf1Extraction] = useState<PdfExtraction | null>(null)
  const [pdf2Extraction, setPdf2Extraction] = useState<PdfExtraction | null>(null)
  const [diffParts, setDiffParts] = useState<Change[]>([])
  const [removedTokenIndexes, setRemovedTokenIndexes] = useState<Set<number>>(new Set())
  const [addedTokenIndexes, setAddedTokenIndexes] = useState<Set<number>>(new Set())
  const [isComparing, setIsComparing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [comparisonNote, setComparisonNote] = useState<string | null>(null)

  const workerRef = useRef<Worker | null>(null)
  const pendingJobIdRef = useRef<number | null>(null)
  const jobCounterRef = useRef(0)

  useEffect(() => {
    const worker = new Worker(new URL('./workers/diffWorker.ts', import.meta.url), {
      type: 'module',
    })

    workerRef.current = worker

    const handleMessage = (event: MessageEvent<DiffWorkerResponse>) => {
      const data = event.data
      if (!data || data.jobId !== pendingJobIdRef.current) {
        return
      }

      pendingJobIdRef.current = null

      if (data.type === 'result') {
        setDiffParts(data.payload.textDiff)
        setRemovedTokenIndexes(new Set(data.payload.removedTokenIndexes))
        setAddedTokenIndexes(new Set(data.payload.addedTokenIndexes))
        setError(null)
      } else {
        setDiffParts([])
        setRemovedTokenIndexes(new Set())
        setAddedTokenIndexes(new Set())
        setError(data.payload)
      }

      setIsComparing(false)
    }

    const handleError = () => {
      if (pendingJobIdRef.current === null) {
        return
      }

      setDiffParts([])
      setRemovedTokenIndexes(new Set())
      setAddedTokenIndexes(new Set())
      setError('Unable to complete comparison in background worker.')
      pendingJobIdRef.current = null
      setIsComparing(false)
    }

    worker.addEventListener('message', handleMessage)
    worker.addEventListener('error', handleError)

    return () => {
      worker.removeEventListener('message', handleMessage)
      worker.removeEventListener('error', handleError)
      worker.terminate()
      workerRef.current = null
    }
  }, [])

  useEffect(() => {
    let isCancelled = false

    const compare = async () => {
      if (!pdf1 || !pdf2) {
        setDiffParts([])
        setIsComparing(false)
        setError(null)
        setComparisonNote(null)
        setPdf1Extraction(null)
        setPdf2Extraction(null)
        setRemovedTokenIndexes(new Set())
        setAddedTokenIndexes(new Set())
        return
      }

      setIsComparing(true)
      setError(null)
      setDiffParts([])
      setRemovedTokenIndexes(new Set())
      setAddedTokenIndexes(new Set())
      setComparisonNote(null)

      try {
        const [extraction1, extraction2] = await Promise.all([
          extractTextFromPdf(pdf1),
          extractTextFromPdf(pdf2),
        ])

        if (isCancelled) {
          return
        }

        setPdf1Extraction(extraction1)
        setPdf2Extraction(extraction2)

        const totalLength =
          extraction1.fullText.length + extraction2.fullText.length
        if (totalLength > ABSOLUTE_DIFF_LIMIT) {
          setError(
            `Documents are too large for an in-browser comparison (combined text length ${totalLength.toLocaleString()} characters). Try comparing smaller sections.`,
          )
          setDiffParts([])
          setRemovedTokenIndexes(new Set())
          setAddedTokenIndexes(new Set())
          setIsComparing(false)
          setComparisonNote(null)
          return
        }

        let mode: DiffMode = 'word'
        if (totalLength > PARAGRAPH_DIFF_THRESHOLD) {
          mode = 'sentence'
          setComparisonNote(
            'Large documents are compared at sentence level for faster results. Highlights may be less granular.',
          )
        } else if (totalLength > WORD_DIFF_THRESHOLD) {
          mode = 'paragraph'
          setComparisonNote(
            'Medium documents are compared at paragraph level to balance speed and detail.',
          )
        }

        const worker = workerRef.current

        const requestPayload: DiffWorkerRequest = {
          jobId: 0,
          text1: extraction1.fullText,
          text2: extraction2.fullText,
          tokens1: extraction1.tokens,
          tokens2: extraction2.tokens,
          mode,
        }

        if (worker) {
          jobCounterRef.current += 1
          const jobId = jobCounterRef.current
          pendingJobIdRef.current = jobId
          worker.postMessage({ ...requestPayload, jobId })
        } else {
          const textDiff =
            mode === 'sentence'
              ? diffSentences(extraction1.fullText, extraction2.fullText)
              : mode === 'paragraph'
              ? diffLines(extraction1.fullText, extraction2.fullText)
              : diffWords(extraction1.fullText, extraction2.fullText)
          const tokenDiff = diffArrays(extraction1.tokens, extraction2.tokens, {
            comparator: (left, right) => left.text === right.text,
          })

          const removed = new Set<number>()
          const added = new Set<number>()
          tokenDiff.forEach((part) => {
            if (part.removed) {
              part.value.forEach((token) => removed.add(token.absoluteIndex))
            } else if (part.added) {
              part.value.forEach((token) => added.add(token.absoluteIndex))
            }
          })

          setDiffParts(textDiff)
          setRemovedTokenIndexes(removed)
          setAddedTokenIndexes(added)
          setIsComparing(false)
        }
      } catch (err) {
        if (isCancelled) {
          return
        }

        const fallbackMessage = 'Unable to compare the PDF files.'
        const errorMessage = err instanceof Error ? err.message : fallbackMessage
        const normalizedMessage =
          errorMessage === 'Invalid page request'
            ? 'Unable to read at least one page of the PDF. Please ensure the file is not corrupted or password protected.'
            : errorMessage || fallbackMessage

        setError(normalizedMessage)
        setDiffParts([])
        setRemovedTokenIndexes(new Set())
        setAddedTokenIndexes(new Set())
        setIsComparing(false)
        setComparisonNote(null)
      }
    }

    compare()

    return () => {
      isCancelled = true
    }
  }, [pdf1, pdf2])

  const diffStats = useMemo(() => {
    let added = 0
    let removed = 0

    diffParts.forEach((part) => {
      if (!part.added && !part.removed) {
        return
      }
      const words = part.value
        .split(/\s+/)
        .filter((segment) => segment.trim().length > 0).length
      if (part.added) {
        added += words
      } else if (part.removed) {
        removed += words
      }
    })

    return { added, removed }
  }, [diffParts])

  const { leftSegments, rightSegments } = useMemo(() => {
    const left: DiffSegment[] = []
    const right: DiffSegment[] = []

    diffParts.forEach((part) => {
      if (part.added) {
        right.push({ value: part.value, type: 'added' })
      } else if (part.removed) {
        left.push({ value: part.value, type: 'removed' })
      } else {
        left.push({ value: part.value, type: 'unchanged' })
        right.push({ value: part.value, type: 'unchanged' })
      }
    })

    return { leftSegments: left, rightSegments: right }
  }, [diffParts])

    const buildUploadProps = (
      setPdf: (file: File | null) => void,
      currentFile: File | null,
      setExtraction: (extraction: PdfExtraction | null) => void,
    ): UploadProps => ({
    name: 'pdf',
    multiple: false,
    accept: '.pdf',
    beforeUpload: (file) => {
      const isPDF = file.type === 'application/pdf'
      if (!isPDF) {
        message.error('You can only upload PDF files!')
        return false
      }
      setPdf(file)
        setExtraction(null)
      message.success(`${file.name} ready for comparison`)
      return false
    },
    onRemove: () => {
      setPdf(null)
        setExtraction(null)
      setDiffParts([])
      setError(null)
      setIsComparing(false)
      setComparisonNote(null)
        setRemovedTokenIndexes(new Set())
        setAddedTokenIndexes(new Set())
    },
    fileList: currentFile
      ? ([
          {
            uid: `${currentFile.name}-${currentFile.lastModified}`,
            name: currentFile.name,
            status: 'done',
          },
        ] as UploadFile[])
      : [],
  })

  const uploadProps1 = buildUploadProps(setPdf1, pdf1, setPdf1Extraction)
  const uploadProps2 = buildUploadProps(setPdf2, pdf2, setPdf2Extraction)

  const hasComparisonInputs = Boolean(pdf1 && pdf2)
  const hasDiffHighlights = diffParts.some((part) => part.added || part.removed)

  return (
    <div className="page-container">
      <Title level={1} className="page-title">
        Compare PDF
      </Title>

      <Row gutter={[24, 24]} justify="space-between" className="upload-row">
        <Col xs={24} lg={12} xl={12}>
          <Card title="Upload First PDF" bordered className="upload-card">
            <Dragger {...uploadProps1}>
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">Click or drag a PDF file into this area</p>
              <p className="ant-upload-hint">Choose the baseline document</p>
            </Dragger>

              <div className={pdf1 ? 'pdf-preview' : 'pdf-preview empty'}>
                {pdf1 ? (
                  <PdfViewerWithHighlights
                    file={pdf1}
                    extraction={pdf1Extraction}
                    highlights={removedTokenIndexes}
                    highlightType="removed"
                  />
                ) : (
                  <Text type="secondary">Upload a PDF to see it here.</Text>
                )}
              </div>
          </Card>
        </Col>

        <Col xs={24} lg={12} xl={12}>
          <Card title="Upload Second PDF" bordered className="upload-card">
            <Dragger {...uploadProps2}>
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">Click or drag a PDF file into this area</p>
              <p className="ant-upload-hint">Choose the document to compare against</p>
            </Dragger>

              <div className={pdf2 ? 'pdf-preview' : 'pdf-preview empty'}>
                {pdf2 ? (
                  <PdfViewerWithHighlights
                    file={pdf2}
                    extraction={pdf2Extraction}
                    highlights={addedTokenIndexes}
                    highlightType="added"
                  />
                ) : (
                  <Text type="secondary">Upload a PDF to see it here.</Text>
                )}
              </div>
          </Card>
        </Col>
      </Row>

      {hasComparisonInputs && (
        <Card className="result-card" title="Comparison Result">
          {isComparing && (
            <div className="result-loading">
              <Spin tip="Extracting text and calculating differences..." />
            </div>
          )}

          {!isComparing && error && <Alert type="error" message={error} showIcon />}

          {!isComparing && !error && (
            <Space direction="vertical" size={16} className="result-content">
              {comparisonNote && <Alert type="info" showIcon message={comparisonNote} />}

              <div className="result-summary">
                <Tag color={diffStats.added > 0 ? 'green' : 'default'}>
                  {diffStats.added} words added
                </Tag>
                <Tag color={diffStats.removed > 0 ? 'red' : 'default'}>
                  {diffStats.removed} words removed
                </Tag>
              </div>

              {hasDiffHighlights ? (
                <div className="diff-side-by-side">
                  <div className="diff-column">
                    <div className="diff-column-title">First PDF</div>
                    <div className="diff-viewer">
                      {leftSegments.length > 0 ? (
                        leftSegments.map((segment, index) => {
                          const classes = ['diff-part']
                          if (segment.type === 'added') {
                            classes.push('added')
                          } else if (segment.type === 'removed') {
                            classes.push('removed')
                          }

                          return (
                            <span key={`result-left-${index}`} className={classes.join(' ')}>
                              {segment.value}
                            </span>
                          )
                        })
                      ) : (
                        <Text type="secondary">No content.</Text>
                      )}
                    </div>
                  </div>

                  <div className="diff-column">
                    <div className="diff-column-title">Second PDF</div>
                    <div className="diff-viewer">
                      {rightSegments.length > 0 ? (
                        rightSegments.map((segment, index) => {
                          const classes = ['diff-part']
                          if (segment.type === 'added') {
                            classes.push('added')
                          } else if (segment.type === 'removed') {
                            classes.push('removed')
                          }

                          return (
                            <span key={`result-right-${index}`} className={classes.join(' ')}>
                              {segment.value}
                            </span>
                          )
                        })
                      ) : (
                        <Text type="secondary">No content.</Text>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <Alert
                  type="success"
                  showIcon
                  message="No textual differences detected between the documents."
                />
              )}
            </Space>
          )}
        </Card>
      )}

      {!hasComparisonInputs && (
        <div className="result-placeholder">
          <Text type="secondary">
            Upload both PDFs to extract their text and highlight the differences.
          </Text>
        </div>
      )}
    </div>
  )
}

export default App
