// Small KQL-like boolean query language for filtering flat value lists
// (URLs, IP addresses, accounts, files) in Statistics. Supports AND/OR/NOT
// (case-insensitive keywords), parentheses for grouping, quoted phrases for
// literal substrings, and `*` wildcards, e.g.:
//   "192.168.100.12" AND NOT (*.mordor.local OR freepeople.local)
// Adjacent terms with no explicit operator behave as AND, so a plain
// multi-word search (no operators at all) still works as before.

type Token =
  | { type: 'AND' | 'OR' | 'NOT' | 'LPAREN' | 'RPAREN' }
  | { type: 'TERM'; value: string; quoted: boolean }

type Node =
  | { kind: 'and'; left: Node; right: Node }
  | { kind: 'or'; left: Node; right: Node }
  | { kind: 'not'; child: Node }
  | { kind: 'term'; value: string; quoted: boolean }

export interface KqlQuery {
  test: (value: string) => boolean
  error: string | null
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  const n = input.length
  let i = 0
  while (i < n) {
    const ch = input[i]
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++
      continue
    }
    if (ch === '(') {
      tokens.push({ type: 'LPAREN' })
      i++
      continue
    }
    if (ch === ')') {
      tokens.push({ type: 'RPAREN' })
      i++
      continue
    }
    if (ch === '"') {
      let j = i + 1
      let buf = ''
      while (j < n && input[j] !== '"') {
        if (input[j] === '\\' && j + 1 < n) {
          buf += input[j + 1]
          j += 2
          continue
        }
        buf += input[j]
        j++
      }
      if (j >= n) throw new Error('Не хватает закрывающей кавычки')
      tokens.push({ type: 'TERM', value: buf, quoted: true })
      i = j + 1
      continue
    }
    let j = i
    while (j < n && !' \t\n\r()'.includes(input[j])) j++
    const word = input.slice(i, j)
    const upper = word.toUpperCase()
    if (upper === 'AND') tokens.push({ type: 'AND' })
    else if (upper === 'OR') tokens.push({ type: 'OR' })
    else if (upper === 'NOT') tokens.push({ type: 'NOT' })
    else tokens.push({ type: 'TERM', value: word, quoted: false })
    i = j
  }
  return tokens
}

function startsPrimary(tok: Token | undefined): boolean {
  return !!tok && (tok.type === 'TERM' || tok.type === 'LPAREN' || tok.type === 'NOT')
}

function parse(tokens: Token[]): Node {
  let pos = 0
  const peek = () => tokens[pos]
  const advance = () => tokens[pos++]

  function parseOr(): Node {
    let left = parseAnd()
    while (peek() && peek().type === 'OR') {
      advance()
      left = { kind: 'or', left, right: parseAnd() }
    }
    return left
  }

  function parseAnd(): Node {
    let left = parseNot()
    while (peek() && (peek().type === 'AND' || startsPrimary(peek()))) {
      if (peek().type === 'AND') advance()
      left = { kind: 'and', left, right: parseNot() }
    }
    return left
  }

  function parseNot(): Node {
    if (peek() && peek().type === 'NOT') {
      advance()
      return { kind: 'not', child: parseNot() }
    }
    return parsePrimary()
  }

  function parsePrimary(): Node {
    const tok = peek()
    if (!tok) throw new Error('Неожиданный конец запроса')
    if (tok.type === 'LPAREN') {
      advance()
      const node = parseOr()
      const closing = peek()
      if (!closing || closing.type !== 'RPAREN') throw new Error('Не хватает закрывающей скобки')
      advance()
      return node
    }
    if (tok.type === 'TERM') {
      advance()
      return { kind: 'term', value: tok.value, quoted: tok.quoted }
    }
    throw new Error('Неожиданный оператор в запросе')
  }

  const result = parseOr()
  if (pos < tokens.length) throw new Error('Лишние символы в конце запроса — проверьте скобки')
  return result
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function termMatches(term: { value: string; quoted: boolean }, value: string): boolean {
  if (!term.quoted && term.value.includes('*')) {
    const pattern = `^${term.value.split('*').map(escapeRegex).join('.*')}$`
    try {
      return new RegExp(pattern, 'i').test(value)
    } catch {
      return false
    }
  }
  return value.toLowerCase().includes(term.value.toLowerCase())
}

function evaluate(node: Node, value: string): boolean {
  if (node.kind === 'and') return evaluate(node.left, value) && evaluate(node.right, value)
  if (node.kind === 'or') return evaluate(node.left, value) || evaluate(node.right, value)
  if (node.kind === 'not') return !evaluate(node.child, value)
  return termMatches(node, value)
}

export function compileKqlQuery(query: string): KqlQuery {
  const trimmed = query.trim()
  if (!trimmed) return { test: () => true, error: null }
  try {
    const tokens = tokenize(trimmed)
    if (tokens.length === 0) return { test: () => true, error: null }
    const ast = parse(tokens)
    return { test: (value: string) => evaluate(ast, value), error: null }
  } catch (e) {
    return { test: () => true, error: e instanceof Error ? e.message : 'Ошибка разбора запроса' }
  }
}
