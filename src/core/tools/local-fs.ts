import { readFile, writeFile, mkdir, readdir, stat, access } from 'fs/promises'
import { dirname, resolve, isAbsolute } from 'path'
import { constants } from 'fs'

const READ_MAX_CHARS = Number(process.env.READ_FILE_MAX_CHARS ?? 100_000)

function resolvePath(input: string): string {
  const p = String(input).trim()
  return isAbsolute(p) ? p : resolve(process.cwd(), p)
}

async function assertPathExists(path: string, type: 'file' | 'dir'): Promise<void> {
  await access(path, constants.F_OK)
  const info = await stat(path)
  if (type === 'file' && !info.isFile()) throw new Error(`不是文件: ${path}`)
  if (type === 'dir' && !info.isDirectory()) throw new Error(`不是目录: ${path}`)
}

export async function toolReadFile(args: Record<string, unknown>): Promise<string> {
  const path = resolvePath(String(args.path))
  await assertPathExists(path, 'file')

  const info = await stat(path)
  const content = await readFile(path, 'utf-8')
  const truncated = content.length > READ_MAX_CHARS
  const body = truncated ? content.slice(0, READ_MAX_CHARS) : content

  const header = [
    `路径: ${path}`,
    `大小: ${info.size} bytes`,
    truncated ? `(已截断至 ${READ_MAX_CHARS} 字符)` : ''
  ]
    .filter(Boolean)
    .join('\n')

  return `${header}\n---\n${body}`
}

export async function toolWriteFile(args: Record<string, unknown>): Promise<string> {
  const path = resolvePath(String(args.path))
  const content = String(args.content ?? '')

  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, 'utf-8')

  const info = await stat(path)
  return `已写入 ${info.size} bytes → ${path}`
}

export async function toolListDirectory(args: Record<string, unknown>): Promise<string> {
  const path = resolvePath(String(args.path ?? '.'))
  await assertPathExists(path, 'dir')

  const entries = await readdir(path, { withFileTypes: true })
  const lines: string[] = [`目录: ${path}`, `共 ${entries.length} 项`, '---']

  const sorted = entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  for (const entry of sorted) {
    const full = resolve(path, entry.name)
    if (entry.isDirectory()) {
      lines.push(`[DIR]  ${entry.name}/`)
    } else {
      const info = await stat(full)
      lines.push(`[FILE] ${entry.name}  (${info.size} bytes)`)
    }
  }

  return lines.join('\n')
}
