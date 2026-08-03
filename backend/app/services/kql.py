"""Small KQL-like boolean query language, shared by every backend search
that needs more than a single substring match (Cases list search, the
Analysis correlation graph). AND / OR / NOT keywords (case-insensitive),
parentheses for grouping, "quoted phrases" for a literal substring, and `*`
wildcards, e.g.:
    "192.168.100.12" AND NOT (*.mordor.local OR freepeople.local)
Adjacent terms with no explicit operator behave as AND, so a plain
multi-word search still works as before.

This mirrors frontend/src/utils/kql.ts term for term — keep the two in sync
if the grammar ever changes. The parser here only builds an AST; callers
decide how a leaf term is matched (a single string via `matches_text`, or
translated into a SQLAlchemy condition — see cases.py for that shape) by
supplying their own callbacks to `reduce_node`.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable, List, Optional, TypeVar, Union


class KqlSyntaxError(Exception):
    pass


@dataclass(frozen=True)
class TermNode:
    value: str
    quoted: bool


@dataclass(frozen=True)
class AndNode:
    left: "Node"
    right: "Node"


@dataclass(frozen=True)
class OrNode:
    left: "Node"
    right: "Node"


@dataclass(frozen=True)
class NotNode:
    child: "Node"


Node = Union[TermNode, AndNode, OrNode, NotNode]

_KEYWORDS = {"AND", "OR", "NOT"}


@dataclass(frozen=True)
class _Token:
    type: str  # 'AND' | 'OR' | 'NOT' | 'LPAREN' | 'RPAREN' | 'TERM'
    value: str = ""
    quoted: bool = False


def _tokenize(text: str) -> List[_Token]:
    tokens: List[_Token] = []
    n = len(text)
    i = 0
    while i < n:
        ch = text[i]
        if ch in " \t\n\r":
            i += 1
            continue
        if ch == "(":
            tokens.append(_Token("LPAREN"))
            i += 1
            continue
        if ch == ")":
            tokens.append(_Token("RPAREN"))
            i += 1
            continue
        if ch == '"':
            j = i + 1
            buf = []
            while j < n and text[j] != '"':
                if text[j] == "\\" and j + 1 < n:
                    buf.append(text[j + 1])
                    j += 2
                    continue
                buf.append(text[j])
                j += 1
            if j >= n:
                raise KqlSyntaxError("Не хватает закрывающей кавычки")
            tokens.append(_Token("TERM", value="".join(buf), quoted=True))
            i = j + 1
            continue
        j = i
        while j < n and text[j] not in " \t\n\r()":
            j += 1
        word = text[i:j]
        upper = word.upper()
        if upper in _KEYWORDS:
            tokens.append(_Token(upper))
        else:
            tokens.append(_Token("TERM", value=word, quoted=False))
        i = j
    return tokens


def _starts_primary(tok: Optional[_Token]) -> bool:
    return tok is not None and tok.type in ("TERM", "LPAREN", "NOT")


class _Parser:
    def __init__(self, tokens: List[_Token]):
        self.tokens = tokens
        self.pos = 0

    def _peek(self) -> Optional[_Token]:
        return self.tokens[self.pos] if self.pos < len(self.tokens) else None

    def _advance(self) -> _Token:
        tok = self.tokens[self.pos]
        self.pos += 1
        return tok

    def parse(self) -> Node:
        node = self._parse_or()
        if self.pos < len(self.tokens):
            raise KqlSyntaxError("Лишние символы в конце запроса — проверьте скобки")
        return node

    def _parse_or(self) -> Node:
        left = self._parse_and()
        while self._peek() and self._peek().type == "OR":
            self._advance()
            left = OrNode(left, self._parse_and())
        return left

    def _parse_and(self) -> Node:
        left = self._parse_not()
        while self._peek() and (self._peek().type == "AND" or _starts_primary(self._peek())):
            if self._peek().type == "AND":
                self._advance()
            left = AndNode(left, self._parse_not())
        return left

    def _parse_not(self) -> Node:
        if self._peek() and self._peek().type == "NOT":
            self._advance()
            return NotNode(self._parse_not())
        return self._parse_primary()

    def _parse_primary(self) -> Node:
        tok = self._peek()
        if tok is None:
            raise KqlSyntaxError("Неожиданный конец запроса")
        if tok.type == "LPAREN":
            self._advance()
            node = self._parse_or()
            closing = self._peek()
            if closing is None or closing.type != "RPAREN":
                raise KqlSyntaxError("Не хватает закрывающей скобки")
            self._advance()
            return node
        if tok.type == "TERM":
            self._advance()
            return TermNode(value=tok.value, quoted=tok.quoted)
        raise KqlSyntaxError("Неожиданный оператор в запросе")


def parse_kql(query: str) -> Optional[Node]:
    """Returns None for an empty/whitespace query (no filter — caller should
    skip applying any condition). Raises KqlSyntaxError on malformed syntax;
    callers should catch it, surface str(exc) to the user and treat it the
    same as an empty query (never 500, never silently drop all results).
    """
    trimmed = query.strip()
    if not trimmed:
        return None
    tokens = _tokenize(trimmed)
    if not tokens:
        return None
    return _Parser(tokens).parse()


T = TypeVar("T")


def reduce_node(
    node: Node,
    term_fn: Callable[[str, bool], T],
    and_fn: Callable[[T, T], T],
    or_fn: Callable[[T, T], T],
    not_fn: Callable[[T], T],
) -> T:
    """Generic bottom-up fold over the AST. `term_fn` decides what a leaf
    term means in the caller's domain — a boolean string match (see
    `matches_text` below) or e.g. a SQLAlchemy ILIKE condition; `and_fn`/
    `or_fn`/`not_fn` combine those into whatever compound value that domain
    uses (Python booleans need real `and`/`or`/`not`, not the operators,
    since short-circuiting isn't needed and SQLAlchemy conditions must go
    through `and_()`/`or_()`/`not_()` instead of Python's boolean operators).
    """
    if isinstance(node, AndNode):
        return and_fn(
            reduce_node(node.left, term_fn, and_fn, or_fn, not_fn),
            reduce_node(node.right, term_fn, and_fn, or_fn, not_fn),
        )
    if isinstance(node, OrNode):
        return or_fn(
            reduce_node(node.left, term_fn, and_fn, or_fn, not_fn),
            reduce_node(node.right, term_fn, and_fn, or_fn, not_fn),
        )
    if isinstance(node, NotNode):
        return not_fn(reduce_node(node.child, term_fn, and_fn, or_fn, not_fn))
    return term_fn(node.value, node.quoted)


def matches_text(term_value: str, quoted: bool, text: Optional[str]) -> bool:
    """Single-string term matcher — substring match, or glob-style wildcard
    match (`*`) for unquoted terms. Used to build simple term_fn callbacks
    for in-memory (non-SQL) searches, e.g. the Analysis correlation graph.
    """
    if not text:
        return False
    if not quoted and "*" in term_value:
        pattern = "^" + ".*".join(re.escape(p) for p in term_value.split("*")) + "$"
        return re.match(pattern, text, re.IGNORECASE) is not None
    return term_value.lower() in text.lower()


def evaluate_text(node: Node, term_matcher: Callable[[str, bool], bool]) -> bool:
    """Convenience wrapper around reduce_node for plain boolean predicates."""
    return reduce_node(
        node, term_matcher,
        lambda a, b: a and b,
        lambda a, b: a or b,
        lambda a: not a,
    )


def escape_like(text: str) -> str:
    """Escapes SQL LIKE/ILIKE special characters (%, _, \\) in literal text."""
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def term_to_ilike_pattern(term_value: str, quoted: bool) -> str:
    """Converts one KQL term into an ILIKE pattern: literal substring match
    for quoted/plain terms (`%text%`), or a `*`-as-`%` glob translation for
    unquoted wildcard terms (already anchored by LIKE's whole-value
    semantics, so `*.mordor.local` becomes `%.mordor.local` — "ends with",
    not "contains anywhere" — matching matches_text's wildcard behavior).
    """
    if not quoted and "*" in term_value:
        return "%".join(escape_like(part) for part in term_value.split("*"))
    return f"%{escape_like(term_value)}%"
