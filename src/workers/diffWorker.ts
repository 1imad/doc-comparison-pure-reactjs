/// <reference lib="webworker" />

import {
  diffArrays,
  diffLines,
  diffSentences,
  diffWords,
  type Change,
} from 'diff'

type DiffMode = 'word' | 'paragraph' | 'sentence'

type NormalizedRect = {
  x: number
  y: number
  width: number
  height: number
}

type DiffToken = {
  text: string
  pageIndex: number
  itemIndex: number
  absoluteIndex: number
  rect: NormalizedRect
}

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

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope

ctx.onmessage = (event: MessageEvent<DiffWorkerRequest>) => {
  const { jobId, text1, text2, tokens1, tokens2, mode } = event.data

  try {
    const textDiff =
      mode === 'sentence'
        ? diffSentences(text1, text2)
        : mode === 'paragraph'
        ? diffLines(text1, text2)
        : diffWords(text1, text2)

    const tokenDiff = diffArrays(tokens1, tokens2, {
      comparator: (left, right) => left.text === right.text,
    })

    const removedTokenIndexes: number[] = []
    const addedTokenIndexes: number[] = []

    tokenDiff.forEach((part) => {
      if (part.removed) {
        part.value.forEach((token) => removedTokenIndexes.push(token.absoluteIndex))
      } else if (part.added) {
        part.value.forEach((token) => addedTokenIndexes.push(token.absoluteIndex))
      }
    })

    const response: DiffWorkerResponse = {
      type: 'result',
      jobId,
      payload: { textDiff, removedTokenIndexes, addedTokenIndexes },
    }
    ctx.postMessage(response)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unable to compute differences.'
    const response: DiffWorkerResponse = { type: 'error', jobId, payload: message }
    ctx.postMessage(response)
  }
}

export {}
