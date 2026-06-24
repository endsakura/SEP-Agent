import { createHash, randomUUID } from 'crypto'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'

export function generateId(): string {
  return randomUUID()
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
}

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(path, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export async function writeJson(path: string, data: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(data, null, 2), 'utf-8')
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

/** 本地 fallback embedding：确定性 hash → 向量 */
export function hashEmbedding(text: string, dims = 384): number[] {
  const vec = new Array(dims).fill(0)
  const normalized = text.toLowerCase().trim()
  for (let i = 0; i < normalized.length; i++) {
    const hash = createHash('sha256')
      .update(`${normalized[i]}:${i % dims}`)
      .digest()
    const idx = hash.readUInt16BE(0) % dims
    const sign = hash[2] % 2 === 0 ? 1 : -1
    vec[idx] += sign * (1 + (hash[3] / 255))
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1
  return vec.map((v) => v / norm)
}

export function truncate(text: string, maxLen: number): string {
  return text.length <= maxLen ? text : text.slice(0, maxLen - 3) + '...'
}

export function joinPath(...parts: string[]): string {
  return join(...parts)
}
