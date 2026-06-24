import type { AgentConfig } from '../types/index.js'
import { hashEmbedding } from '../utils/index.js'

interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface ChatCompletionResponse {
  choices: Array<{
    message: { content: string }
  }>
}

export class LLMClient {
  constructor(private config: Pick<AgentConfig, 'llmApiKey' | 'llmBaseUrl' | 'llmModel'>) {}

  async chat(messages: ChatCompletionMessage[], temperature = 0.7): Promise<string> {
    const url = `${this.config.llmBaseUrl.replace(/\/$/, '')}/chat/completions`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.llmApiKey}`
      },
      body: JSON.stringify({
        model: this.config.llmModel,
        messages,
        temperature
      })
    })

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`LLM API error ${response.status}: ${err}`)
    }

    const data = (await response.json()) as ChatCompletionResponse
    return data.choices[0]?.message?.content ?? ''
  }

  async embed(text: string): Promise<number[]> {
    const { embeddingApiKey, embeddingBaseUrl, embeddingModel } = this.config as AgentConfig

    if (embeddingApiKey && embeddingBaseUrl && embeddingModel) {
      try {
        const url = `${embeddingBaseUrl.replace(/\/$/, '')}/embeddings`
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${embeddingApiKey}`
          },
          body: JSON.stringify({ model: embeddingModel, input: text })
        })
        if (response.ok) {
          const data = (await response.json()) as { data: Array<{ embedding: number[] }> }
          return data.data[0]?.embedding ?? hashEmbedding(text)
        }
      } catch {
        // fallback below
      }
    }

    return hashEmbedding(text)
  }
}

export class EmbeddingService {
  constructor(private llm: LLMClient) {}

  async embed(text: string): Promise<number[]> {
    return this.llm.embed(text)
  }
}
