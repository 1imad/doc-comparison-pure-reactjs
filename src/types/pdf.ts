export type NormalizedRect = {
  x: number
  y: number
  width: number
  height: number
}

export type PdfToken = {
  text: string
  pageIndex: number
  itemIndex: number
  absoluteIndex: number
  rect: NormalizedRect
}

export type PdfExtraction = {
  tokens: PdfToken[]
  fullText: string
  pageMetrics: { width: number; height: number }[]
}
