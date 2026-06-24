export interface SearchHit {
  title: string
  url: string
  snippet: string
}

export type WebSearchProvider = 'tavily' | 'brave' | 'serpapi' | 'duckduckgo'

function getProvider(): WebSearchProvider {
  const explicit = process.env.WEB_SEARCH_PROVIDER?.toLowerCase()
  if (explicit === 'tavily' || explicit === 'brave' || explicit === 'serpapi' || explicit === 'duckduckgo') {
    return explicit
  }
  if (process.env.TAVILY_API_KEY) return 'tavily'
  if (process.env.BRAVE_SEARCH_API_KEY) return 'brave'
  if (process.env.SERPAPI_API_KEY) return 'serpapi'
  return 'duckduckgo'
}

function formatResults(query: string, hits: SearchHit[], provider: string): string {
  if (hits.length === 0) {
    return `搜索「${query}」无结果 (provider: ${provider})`
  }

  const body = hits
    .map((h, i) => `${i + 1}. ${h.title}\n   URL: ${h.url}\n   ${h.snippet}`)
    .join('\n\n')

  return `搜索「${query}」(${provider}, ${hits.length} 条结果)\n\n${body}`
}

/** Tavily — https://tavily.com */
async function searchTavily(query: string): Promise<SearchHit[]> {
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) throw new Error('未配置 TAVILY_API_KEY')

  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: 8,
      include_answer: false
    })
  })

  if (!response.ok) {
    throw new Error(`Tavily API ${response.status}: ${await response.text()}`)
  }

  const data = (await response.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>
  }

  return (data.results ?? []).map((r) => ({
    title: r.title ?? '(无标题)',
    url: r.url ?? '',
    snippet: r.content ?? ''
  }))
}

/** Brave Search API — https://brave.com/search/api/ */
async function searchBrave(query: string): Promise<SearchHit[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY
  if (!apiKey) throw new Error('未配置 BRAVE_SEARCH_API_KEY')

  const url = new URL('https://api.search.brave.com/res/v1/web/search')
  url.searchParams.set('q', query)
  url.searchParams.set('count', '8')

  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': apiKey
    }
  })

  if (!response.ok) {
    throw new Error(`Brave Search API ${response.status}: ${await response.text()}`)
  }

  const data = (await response.json()) as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> }
  }

  return (data.web?.results ?? []).map((r) => ({
    title: r.title ?? '(无标题)',
    url: r.url ?? '',
    snippet: r.description ?? ''
  }))
}

/** SerpAPI — https://serpapi.com */
async function searchSerpApi(query: string): Promise<SearchHit[]> {
  const apiKey = process.env.SERPAPI_API_KEY
  if (!apiKey) throw new Error('未配置 SERPAPI_API_KEY')

  const url = new URL('https://serpapi.com/search.json')
  url.searchParams.set('engine', 'google')
  url.searchParams.set('q', query)
  url.searchParams.set('api_key', apiKey)
  url.searchParams.set('num', '8')

  const response = await fetch(url.toString())
  if (!response.ok) {
    throw new Error(`SerpAPI ${response.status}: ${await response.text()}`)
  }

  const data = (await response.json()) as {
    organic_results?: Array<{ title?: string; link?: string; snippet?: string }>
  }

  return (data.organic_results ?? []).map((r) => ({
    title: r.title ?? '(无标题)',
    url: r.link ?? '',
    snippet: r.snippet ?? ''
  }))
}

/** DuckDuckGo HTML 搜索（无需 API Key） */
async function searchDuckDuckGo(query: string): Promise<SearchHit[]> {
  const response = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (compatible; SelfEvolvingAgent/1.0)'
    },
    body: new URLSearchParams({ q: query })
  })

  if (!response.ok) {
    throw new Error(`DuckDuckGo 搜索失败 ${response.status}`)
  }

  const html = await response.text()
  const hits: SearchHit[] = []

  // DuckDuckGo HTML: result__a + result__snippet
  const linkRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g

  const links: Array<{ url: string; title: string }> = []
  let m: RegExpExecArray | null
  while ((m = linkRe.exec(html)) !== null && links.length < 8) {
    const rawHref = m[1]
    const url = extractDdgUrl(rawHref)
    const title = m[2].replace(/<[^>]+>/g, '').trim()
    if (title && url.startsWith('http')) links.push({ url, title })
  }

  const snippets: string[] = []
  while ((m = snippetRe.exec(html)) !== null && snippets.length < 8) {
    snippets.push(m[1].replace(/<[^>]+>/g, '').trim())
  }

  for (let i = 0; i < links.length; i++) {
    hits.push({
      title: links[i].title,
      url: links[i].url,
      snippet: snippets[i] ?? ''
    })
  }

  // 备用：Instant Answer API（结果较少但稳定）
  if (hits.length === 0) {
    const iaUrl = new URL('https://api.duckduckgo.com/')
    iaUrl.searchParams.set('q', query)
    iaUrl.searchParams.set('format', 'json')
    iaUrl.searchParams.set('no_html', '1')
    iaUrl.searchParams.set('skip_disambig', '1')

    const iaRes = await fetch(iaUrl.toString())
    if (iaRes.ok) {
      const ia = (await iaRes.json()) as {
        Heading?: string
        AbstractText?: string
        AbstractURL?: string
        RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>
      }
      if (ia.AbstractText) {
        hits.push({
          title: ia.Heading ?? query,
          url: ia.AbstractURL ?? '',
          snippet: ia.AbstractText
        })
      }
      for (const topic of ia.RelatedTopics ?? []) {
        if (topic.Text && hits.length < 8) {
          hits.push({
            title: topic.Text.slice(0, 80),
            url: topic.FirstURL ?? '',
            snippet: topic.Text
          })
        }
      }
    }
  }

  return hits
}

async function runProvider(provider: WebSearchProvider, query: string): Promise<SearchHit[]> {
  switch (provider) {
    case 'tavily':
      return searchTavily(query)
    case 'brave':
      return searchBrave(query)
    case 'serpapi':
      return searchSerpApi(query)
    case 'duckduckgo':
      return searchDuckDuckGo(query)
  }
}

/** 真实网络搜索，按配置选择 provider，失败时自动降级到 DuckDuckGo */
export async function toolWebSearch(args: Record<string, unknown>): Promise<string> {
  const query = String(args.query ?? '').trim()
  if (!query) throw new Error('query 不能为空')

  const primary = getProvider()
  const fallbacks: WebSearchProvider[] = ['tavily', 'brave', 'serpapi', 'duckduckgo'].filter(
    (p) => p !== primary
  ) as WebSearchProvider[]

  const chain = [primary, ...fallbacks]

  let lastError: Error | null = null
  for (const provider of chain) {
    try {
      // 无 key 的 provider 跳过（duckduckgo 除外）
      if (provider === 'tavily' && !process.env.TAVILY_API_KEY) continue
      if (provider === 'brave' && !process.env.BRAVE_SEARCH_API_KEY) continue
      if (provider === 'serpapi' && !process.env.SERPAPI_API_KEY) continue

      const hits = await runProvider(provider, query)
      if (hits.length > 0) {
        return formatResults(query, hits, provider)
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
    }
  }

  throw lastError ?? new Error(`搜索「${query}」未返回任何结果`)
}

function extractDdgUrl(href: string): string {
  try {
    const match = href.match(/uddg=([^&]+)/)
    if (match) return decodeURIComponent(match[1])
    if (href.startsWith('http')) return href
  } catch {
    // fall through
  }
  return href
}

export function getWebSearchProviderLabel(): string {
  return getProvider()
}
