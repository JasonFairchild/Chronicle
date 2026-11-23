// Holds CLAUDE.md#top-down (§3.1).
import type { AST, Rule, Scope, SourceCode } from 'eslint'

type Statement = AST.Program['body'][number]

/** A statement of one scope's body. */
interface Unit {
  start: number
  end: number
  label: string
  /** The function it declares, if any. */
  declared?: Scope.Variable
  /** That function, unless it's exported or returned. */
  helper?: Scope.Variable
}

/** Where a helper is first used: the statement, by index, and the position of that use. */
interface FirstUse {
  user: number
  position: number
}

function unwrapExport(statement: Statement) {
  const isExport =
    statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration'
  return isExport && statement.declaration ? statement.declaration : statement
}

function declaredName(node: ReturnType<typeof unwrapExport>) {
  if (node.type === 'FunctionDeclaration') return { name: node.id?.name, declares: node }
  if (node.type !== 'VariableDeclaration' || node.declarations.length !== 1) return undefined
  const [declarator] = node.declarations
  if (declarator.id.type !== 'Identifier') return undefined
  const isFunction =
    declarator.init?.type === 'ArrowFunctionExpression' ||
    declarator.init?.type === 'FunctionExpression'
  // A `let` holding a function is a slot assigned later, not a helper.
  const isHelper = isFunction && node.kind === 'const'
  return { name: declarator.id.name, declares: isHelper ? declarator : undefined }
}

/** A property of the object its own scope returns, as a store or composable hands out actions. */
function isReturnedBy(identifier: Rule.Node, body: Rule.Node | null) {
  const property = identifier.parent
  if (property?.type !== 'Property' || property.value !== identifier) return false
  let node: Rule.Node | null = property.parent
  for (; node && !node.type.includes('Function'); node = node.parent) {
    if (node.type === 'ReturnStatement') return node.parent === body
  }
  return false
}

/** An export, or a scope's returned object, hands a function out rather than using it. */
function isPublishing(reference: Scope.Reference, body: Rule.Node | null) {
  const identifier = reference.identifier as Rule.Node
  const type = identifier.parent?.type
  const isExport = type === 'ExportSpecifier' || type === 'ExportDefaultDeclaration'
  return isExport || isReturnedBy(identifier, body)
}

function toUnit(statement: Statement, sourceCode: SourceCode): Unit {
  const [start, end] = sourceCode.getRange(statement)
  const found = declaredName(unwrapExport(statement))
  const label = found?.name
    ? `\`${found.name}\``
    : statement.type === 'ReturnStatement'
      ? 'the `return`'
      : `line ${sourceCode.getLoc(statement).start.line}`
  const declared =
    found?.declares &&
    sourceCode.getDeclaredVariables(found.declares as Rule.Node).find((v) => v.name === found.name)
  const body = (statement as Rule.Node).parent
  const isPublic =
    statement.type.startsWith('Export') ||
    declared?.references.some((reference) => isPublishing(reference, body))
  return { start, end, label, declared, helper: isPublic ? undefined : declared }
}

/** Uses above a helper, from recursion or a cycle, are left to `no-use-before-define`. */
function firstUses(units: Unit[], sourceCode: SourceCode) {
  const unitAt = (position: number) =>
    units.findIndex((u) => u.start <= position && position < u.end)
  return units.map((unit, index) => {
    let first: FirstUse | undefined
    for (const reference of unit.helper?.references ?? []) {
      const position = sourceCode.getRange(reference.identifier as Rule.Node)[0]
      const user = unitAt(position)
      if (user > index && (!first || position < first.position)) first = { user, position }
    }
    return first
  })
}

/** Indexes outside one longest increasing subsequence of positions: the fewest helpers to move. */
function outOfOrder(positions: number[]) {
  const longest = positions.map(() => 1)
  const previous = positions.map(() => -1)
  positions.forEach((position, i) => {
    for (let j = 0; j < i; j++) {
      if (positions[j] < position && longest[j] + 1 > longest[i]) {
        longest[i] = longest[j] + 1
        previous[i] = j
      }
    }
  })
  const kept = new Set<number>()
  for (let i = longest.indexOf(Math.max(...longest)); i !== -1; i = previous[i]) kept.add(i)
  return positions.flatMap((_, i) => (kept.has(i) ? [] : [i]))
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Order helpers above their first user, in the order it uses them' },
    schema: [],
    messages: {
      above: '{{helper}} goes just above {{sibling}}, since {{user}} uses it first.',
      below: '{{helper}} goes just below {{sibling}}, since {{user}} uses it last.',
      stray:
        '{{helper}} is first used by {{user}}, but {{stray}}, between them, is not its helper.',
    },
  },
  create(context) {
    const { sourceCode } = context

    function check(body: Statement[]) {
      const units = body.map((statement) => toUnit(statement, sourceCode))
      const uses = firstUses(units, sourceCode)

      /** Reports each of one user's helpers that must move, beside a sibling it belongs next to. */
      function checkSiblings(user: number) {
        const placed = uses.flatMap((use, at) => (use?.user === user ? [at] : []))
        const position = (at: number) => uses[at]!.position
        const byUse = [...placed].sort((a, b) => position(a) - position(b))
        for (const misplaced of outOfOrder(placed.map(position))) {
          const at = placed[misplaced]
          const next = byUse[byUse.indexOf(at) + 1]
          const sibling = next ?? byUse[byUse.indexOf(at) - 1]
          const data = {
            helper: units[at].label,
            sibling: units[sibling].label,
            user: units[user].label,
          }
          const node = units[at].helper!.identifiers[0]
          context.report({ node, messageId: next === undefined ? 'below' : 'above', data })
        }
      }

      /** Whether a statement's chain of first users, helper to helper, ends at `user`. */
      function serves(index: number, user: number) {
        let current: number | undefined = index
        while (current !== undefined && current < user) current = uses[current]?.user
        return current === user
      }

      /** Reports a helper that a function uses first, if another function sits between them. */
      function checkBetween(index: number) {
        const use = uses[index]
        if (!use || !units[use.user].declared) return // A statement's helpers keep only their order.
        const stray = units.findIndex(
          (other, at) => at > index && at < use.user && other.declared && !serves(at, use.user),
        )
        if (stray === -1) return
        const data = {
          helper: units[index].label,
          stray: units[stray].label,
          user: units[use.user].label,
        }
        context.report({ node: units[index].helper!.identifiers[0], messageId: 'stray', data })
      }

      for (const user of new Set(uses.map((use) => use?.user))) {
        if (user !== undefined) checkSiblings(user)
      }
      units.forEach((_, index) => checkBetween(index))
    }

    return {
      Program: (node) => check(node.body),
      ':function > BlockStatement': (node: Rule.Node) => {
        if (node.type === 'BlockStatement') check(node.body)
      },
    }
  },
}

export default rule
