/// <reference lib="webworker" />

import { diffLines, diffSentences, diffWords, type Change } from 'diff'

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

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope

ctx.onmessage = (event: MessageEvent<DiffWorkerRequest>) => {
  const { jobId, text1, text2, mode } = event.data

  try {
    const parts =
      mode === 'sentence'
        ? diffSentences(text1, text2)
        : mode === 'paragraph'
        ? diffLines(text1, text2)
        : diffWords(text1, text2)
    const response: DiffWorkerResponse = { type: 'result', jobId, payload: parts }
    ctx.postMessage(response)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unable to compute differences.'
    const response: DiffWorkerResponse = { type: 'error', jobId, payload: message }
    ctx.postMessage(response)
  }
}

export {}
