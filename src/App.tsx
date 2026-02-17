import { useEffect, useMemo, useRef, useState } from 'react'
import { Layout, Row, Col, Spin, message, Typography } from 'antd'
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
import type { TextItem } from 'pdfjs-dist/types/src/display/api'
import pdfWorker from 'pdfjs-dist/build/pdf.worker?url'
import AppHeader from './components/AppHeader'
import HeroSection from './components/HeroSection'
import UploadPanel from './components/UploadPanel'
import SideBySidePdfComparison from './components/SideBySidePdfComparison'
import type { NormalizedRect, PdfExtraction, PdfToken } from './types/pdf'
import type { DiffStats } from './types/diff'
import './App.css'

const { Content, Footer } = Layout
const { Text } = Typography

GlobalWorkerOptions.workerSrc = pdfWorker

const WORD_DIFF_THRESHOLD = 200000
const PARAGRAPH_DIFF_THRESHOLD = 900000
const ABSOLUTE_DIFF_LIMIT = 2600000

type DiffMode = 'word' | 'paragraph' | 'sentence'

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

        const totalLength = extraction1.fullText.length + extraction2.fullText.length
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

  const diffStats = useMemo<DiffStats>(() => {
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

  const hasBaseline = Boolean(pdf1)
  const hasRevised = Boolean(pdf2)
  const hasComparisonInputs = hasBaseline && hasRevised
  const canShowPreviews = hasComparisonInputs && !isComparing && !error
  const canShowComparisonPanels = canShowPreviews

  const comparisonComplete = canShowPreviews

  const resetComparison = () => {
    setPdf1(null)
    setPdf2(null)
    setPdf1Extraction(null)
    setPdf2Extraction(null)
    setDiffParts([])
    setRemovedTokenIndexes(new Set())
    setAddedTokenIndexes(new Set())
    setError(null)
    setIsComparing(false)
    setComparisonNote(null)
    message.info('Workspace cleared')
  }

  return (
    <Layout className="app-shell">
      <AppHeader hasComparisonInputs={hasComparisonInputs} onReset={resetComparison} />

      <Content className="app-content">
        <div className="page-container">
          {isComparing && (
            <div className="comparison-loading">
              <Spin size="large" tip="Generating diff..." />
            </div>
          )}

          <HeroSection
            diffStats={diffStats}
            hasComparisonInputs={hasComparisonInputs}
            comparisonNote={comparisonNote}
          />

          {!comparisonComplete && (
            <Row gutter={[24, 24]} justify="space-between" className="upload-row">
              <Col xs={24} lg={12} xl={12}>
                <UploadPanel
                  title="Upload First PDF"
                  hint="Choose the baseline document"
                  uploadProps={uploadProps1}
                />
              </Col>

              <Col xs={24} lg={12} xl={12}>
                <UploadPanel
                  title="Upload Second PDF"
                  hint="Choose the document to compare against"
                  uploadProps={uploadProps2}
                />
              </Col>
            </Row>
          )}

          {canShowComparisonPanels && (
            <SideBySidePdfComparison
              oldDoc={{
                label: 'Baseline Document',
                file: pdf1,
                extraction: pdf1Extraction,
                highlights: removedTokenIndexes,
                highlightType: 'removed',
              }}
              newDoc={{
                label: 'Revised Document',
                file: pdf2,
                extraction: pdf2Extraction,
                highlights: addedTokenIndexes,
                highlightType: 'added',
              }}
              showPreviews={canShowPreviews}
            />
          )}

        </div>
      </Content>

      <Footer className="app-footer">
        <Text type="secondary">Confidential • Session isolated in-browser</Text>
      </Footer>
    </Layout>
  )
}

export default App
