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
import { diffLines, diffSentences, diffWords, type Change } from 'diff'
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'
import pdfWorker from 'pdfjs-dist/build/pdf.worker?url'
import './App.css'

const { Title, Text } = Typography
const { Dragger } = Upload

GlobalWorkerOptions.workerSrc = pdfWorker

const WORD_DIFF_THRESHOLD = 200000
const PARAGRAPH_DIFF_THRESHOLD = 900000
const ABSOLUTE_DIFF_LIMIT = 2600000

type DiffMode = 'word' | 'paragraph' | 'sentence'

type DiffWorkerRequest = {
  jobId: number
  text1: string
  text2: string
  mode: DiffMode
}

type DiffWorkerResponse =
  | { type: 'result'; jobId: number; payload: Change[] }
  | { type: 'error'; jobId: number; payload: string }

type DiffSegmentType = 'unchanged' | 'added' | 'removed'

type DiffSegment = {
  value: string
  type: DiffSegmentType
}

async function extractTextFromPdf(file: File): Promise<string> {
  const data = await file.arrayBuffer()
  const pdf = await getDocument({ data }).promise

  try {
    const pageTexts: string[] = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      try {
        const page = await pdf.getPage(pageNumber)
        const textContent = await page.getTextContent()
        const pageText = textContent.items
          .map((item) => ('str' in item ? (item as TextItem).str : ''))
          .join(' ')
          .trim()

        if (pageText.length > 0) {
          pageTexts.push(pageText)
        }
      } catch (pageError) {
        console.warn(`Unable to extract page ${pageNumber}`, pageError)
      }
    }

    if (pageTexts.length === 0) {
      throw new Error(
        'No searchable text found. The PDF may be scanned, encrypted, or corrupted.',
      )
    }

    return pageTexts.join('\n')
  } finally {
    pdf.destroy()
  }
}

function App() {
  const [pdf1, setPdf1] = useState<File | null>(null)
  const [pdf2, setPdf2] = useState<File | null>(null)
  const [pdf1Url, setPdf1Url] = useState<string | null>(null)
  const [pdf2Url, setPdf2Url] = useState<string | null>(null)
  const [diffParts, setDiffParts] = useState<Change[]>([])
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
        setDiffParts(data.payload)
        setError(null)
      } else {
        setDiffParts([])
        setError(data.payload)
      }

      setIsComparing(false)
    }

    const handleError = () => {
      if (pendingJobIdRef.current === null) {
        return
      }

      setDiffParts([])
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
    if (!pdf1) {
      setPdf1Url(null)
      return
    }

    const objectUrl = URL.createObjectURL(pdf1)
    setPdf1Url(objectUrl)

    return () => {
      URL.revokeObjectURL(objectUrl)
    }
  }, [pdf1])

  useEffect(() => {
    if (!pdf2) {
      setPdf2Url(null)
      return
    }

    const objectUrl = URL.createObjectURL(pdf2)
    setPdf2Url(objectUrl)

    return () => {
      URL.revokeObjectURL(objectUrl)
    }
  }, [pdf2])

  useEffect(() => {
    let isCancelled = false

    const compare = async () => {
      if (!pdf1 || !pdf2) {
        setDiffParts([])
        setIsComparing(false)
        setError(null)
        setComparisonNote(null)
        return
      }

      setIsComparing(true)
      setError(null)
      setDiffParts([])
      setComparisonNote(null)

      try {
        const [text1, text2] = await Promise.all([
          extractTextFromPdf(pdf1),
          extractTextFromPdf(pdf2),
        ])

        if (isCancelled) {
          return
        }

        const totalLength = text1.length + text2.length
        if (totalLength > ABSOLUTE_DIFF_LIMIT) {
          setError(
            `Documents are too large for an in-browser comparison (combined text length ${totalLength.toLocaleString()} characters). Try comparing smaller sections.`,
          )
          setDiffParts([])
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

        if (worker) {
          jobCounterRef.current += 1
          const jobId = jobCounterRef.current
          pendingJobIdRef.current = jobId
          const payload: DiffWorkerRequest = { jobId, text1, text2, mode }
          worker.postMessage(payload)
        } else {
          const parts =
            mode === 'sentence'
              ? diffSentences(text1, text2)
              : mode === 'paragraph'
              ? diffLines(text1, text2)
              : diffWords(text1, text2)
          setDiffParts(parts)
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
      message.success(`${file.name} ready for comparison`)
      return false
    },
    onRemove: () => {
      setPdf(null)
      setDiffParts([])
      setError(null)
      setIsComparing(false)
      setComparisonNote(null)
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

  const uploadProps1 = buildUploadProps(setPdf1, pdf1)
  const uploadProps2 = buildUploadProps(setPdf2, pdf2)

  const hasComparisonInputs = Boolean(pdf1 && pdf2)
  const hasDiffHighlights = diffParts.some((part) => part.added || part.removed)

  return (
    <div className="page-container">
      <Title level={1} className="page-title">
        Compare PDF
      </Title>

      <Row gutter={[24, 24]} justify="center">
        <Col xs={24} md={12} lg={10}>
          <Card title="Upload First PDF" bordered>
            <Dragger {...uploadProps1}>
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">Click or drag a PDF file into this area</p>
              <p className="ant-upload-hint">Choose the baseline document</p>
            </Dragger>

            <div className={pdf1Url ? 'pdf-preview' : 'pdf-preview empty'}>
              {pdf1Url ? (
                <iframe src={pdf1Url} title="First PDF preview" className="pdf-iframe" />
              ) : (
                <Text type="secondary">Upload a PDF to see it here.</Text>
              )}
            </div>
          </Card>
        </Col>

        <Col xs={24} md={12} lg={10}>
          <Card title="Upload Second PDF" bordered>
            <Dragger {...uploadProps2}>
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">Click or drag a PDF file into this area</p>
              <p className="ant-upload-hint">Choose the document to compare against</p>
            </Dragger>

            <div className={pdf2Url ? 'pdf-preview' : 'pdf-preview empty'}>
              {pdf2Url ? (
                <iframe src={pdf2Url} title="Second PDF preview" className="pdf-iframe" />
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
