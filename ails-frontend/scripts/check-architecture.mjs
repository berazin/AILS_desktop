import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = path.join(frontend, 'src')
const normalize = value => value.split(path.sep).join('/')

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === 'vendor') return []
    const filename = path.join(directory, entry.name)
    return entry.isDirectory() ? sourceFiles(filename) : /\.(ts|tsx)$/.test(entry.name) ? [filename] : []
  })
}

export function references(root = sourceRoot) {
  const result = []
  for (const filename of sourceFiles(root)) {
    const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true)
    const record = (literal, names, typeOnly) => {
      if (!literal || !ts.isStringLiteralLike(literal)) return
      const specifier = literal.text
      if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return
      const target = specifier.startsWith('@/') ? path.join(root, specifier.slice(2)) : path.resolve(path.dirname(filename), specifier)
      const resolved = [target, `${target}.ts`, `${target}.tsx`, path.join(target, 'index.ts'), path.join(target, 'index.tsx')].find(p => fs.existsSync(p) && fs.statSync(p).isFile())
      const line = source.getLineAndCharacterOfPosition(literal.getStart()).line + 1
      result.push({ from: normalize(path.relative(root, filename)), to: normalize(path.relative(root, resolved || target)), names, typeOnly, line })
    }
    const visit = node => {
      if (ts.isImportDeclaration(node)) {
        const clause = node.importClause
        if (!clause) record(node.moduleSpecifier, ['*'], false)
        if (clause?.name) record(node.moduleSpecifier, ['default'], clause.isTypeOnly)
        const bindings = clause?.namedBindings
        if (bindings && ts.isNamespaceImport(bindings)) record(node.moduleSpecifier, ['*'], clause.isTypeOnly)
        if (bindings && ts.isNamedImports(bindings)) for (const symbol of bindings.elements) {
          record(node.moduleSpecifier, [(symbol.propertyName || symbol.name).text], clause.isTypeOnly || symbol.isTypeOnly)
        }
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
        if (node.exportClause && ts.isNamedExports(node.exportClause)) for (const symbol of node.exportClause.elements) {
          record(node.moduleSpecifier, [(symbol.propertyName || symbol.name).text], node.isTypeOnly || symbol.isTypeOnly)
        } else record(node.moduleSpecifier, ['*'], node.isTypeOnly)
      } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
        record(node.arguments[0], ['*'], false)
      } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
        record(node.argument.literal, node.qualifier ? [node.qualifier.getText(source).split('.')[0]] : ['*'], true)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return result
}

export function validate(references, contracts) {
  const errors = []
  for (const ref of references) {
    const [layer, feature] = ref.from.split('/')
    const [targetLayer, targetFeature, ...module] = ref.to.split('/')
    let reason = ''
    if (layer === 'shared' && ['app', 'features'].includes(targetLayer)) reason = 'shared must not depend on app or features'
    else if (layer === 'features' && (targetLayer === 'app' || /^App\./.test(targetLayer))) reason = 'features must not depend on application composition'
    else if (layer === 'features' && targetLayer === 'features' && feature !== targetFeature) {
      const contract = contracts[targetFeature]?.[module.join('/')]
      const allowed = [...(contract?.types || []), ...(contract?.values || [])]
      if (!contract) reason = `private feature module: ${ref.to}`
      else if (ref.names.some(name => !allowed.includes(name))) reason = `not a public export: ${ref.names.join(', ')} in ${ref.to}`
      else if (!ref.typeOnly && ref.names.some(name => !contract.values?.includes(name))) reason = `type contract must use import type: ${ref.to}`
    }
    if (reason) errors.push(`${ref.from}:${ref.line}: ${reason}`)
  }
  return errors
}

export function check() {
  const contracts = JSON.parse(fs.readFileSync(path.join(frontend, 'feature-contracts.json'), 'utf8'))
  const errors = validate(references(), contracts)
  for (const [feature, modules] of Object.entries(contracts)) for (const module of Object.keys(modules)) {
    if (!fs.existsSync(path.join(sourceRoot, 'features', feature, module))) errors.push(`Stale public contract: ${feature}/${module}`)
  }
  if (errors.length) throw new Error(errors.join('\n'))
  console.log('Frontend architecture: shared direction, application composition and feature export contracts passed.')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) check()
