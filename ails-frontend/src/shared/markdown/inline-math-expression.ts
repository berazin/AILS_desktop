// Convert common lecture notation to TeX without modifying the Markdown source.
const superscripts: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁺': '+', '⁻': '-', '⁽': '(', '⁾': ')', 'ⁱ': 'i', 'ⁿ': 'n', 'ᵀ': 'T' }
const subscripts: Record<string, string> = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9', '₊': '+', '₋': '-', '₍': '(', '₎': ')', 'ᵢ': 'i', 'ⱼ': 'j' }
const operators: Record<string, string> = { '−': '-', '·': '\\cdot ', '×': '\\times ', '≈': '\\approx ', '≥': '\\ge ', '≤': '\\le ', '≠': '\\ne ', '←': '\\leftarrow ', '→': '\\to ', '…': '\\ldots ', '–': '\\text{–}' }
const number = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?`
const numericCoordinates = new RegExp(String.raw`^\(\s*${number}(?:\s*,\s*${number}){1,2}\s*\)$`)

export function isMathProse(text: string) {
  return /수식|가중치|편향|절편|기울기|학습률|뉴런|확률|제곱오차|매개변수|내적|벡터|행렬|위첨자|아래첨자|정규화|경사하강|제곱근|다항|미분|손실|비용|선형.?회귀|활성화|\b(?:gradient|regression|derivative|vector|matrix)\b/i.test(text)
    && !/파이썬|Python|코드|문자열|리스트|딕셔너리|튜플|함수 정의|반복문/.test(text)
}

export function inlineMathExpression(value: string, mathProse = false): string | null {
  const probability = /^P\([^()]+\)$/.test(value)
  if (!value || value.length > 1000 || /["'`#$\r\n]|&&|\|\||===?|=>|:=|:\/\/|^[A-Za-z]:[\\/]/.test(value)
    || (value.includes(';') && !probability)) return null
  const compact = value.replace(/\s+/g, '')
  const explicit = /\\[A-Za-z]+|[A-Za-z0-9)}\]]\s*[_^]\s*\{|\^\[[^\]]+\]/.test(value)
  const unicode = /[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁽⁾ⁱⁿᵀ₀₁₂₃₄₅₆₇₈₉₊₋₍₎ᵢⱼŷ√α-ωΑ-Ω−·×≈≥≤≠←]/.test(value) || value.includes('\u20d7')
  const functionNotation = /^(?:[fgJLP])(?:_\{[^}]+\})?\([^()]+\)/.test(value)
  const simpleEquation = /^[A-Za-z0-9+*/^().,=<>!-]+$/.test(compact) && !/[A-Za-z]{2,}/.test(compact) && /^[^=]+=[^=]+(?:=[^=]+)*$/.test(compact)
  const arithmetic = /^[\d.+*/^()-]+$/.test(compact) && /\d/.test(compact) && /[+*/^]|\d-\d/.test(compact) && !/^\d{4}-\d{2}-\d{2}$/.test(compact)
  const coefficient = /^\d+(?:\.\d+)?[A-Za-z]$/.test(compact) || /^\d+\/(?:[A-Za-z]|\(\d*[A-Za-z]\))$/.test(compact)
  const contextual = mathProse && (/^[A-Za-z](?:_[A-Za-z0-9])?$/.test(compact) || /^\(?[A-Za-z](?:,[A-Za-z])+\)?$/.test(compact))
  if (!(explicit || unicode || functionNotation || simpleEquation || arithmetic || coefficient || contextual || numericCoordinates.test(value))) return null
  // Text containing Unicode arrows or units is not necessarily a mathematical expression.
  const words = value.replace(/\b(?:log|ln|exp|sin|cos|tan|size|lambda)\b/g, '').match(/[A-Za-z]{2,}/g) ?? []
  if (!explicit && words.some(word => !(functionNotation && /^[wxyzabmnijWXYZ]+$/.test(word)))) return null
  let expression = value
    .replace(/([A-Za-z])\u20d7/g, '\\vec{$1}')
    .replace(/ŷ/g, '\\hat{y}')
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁽⁾ⁱⁿᵀ]+/g, chars => `^{${[...chars].map(char => superscripts[char]).join('')}}`)
    .replace(/[₀₁₂₃₄₅₆₇₈₉₊₋₍₎ᵢⱼ]+/g, chars => `_{${[...chars].map(char => subscripts[char]).join('')}}`)
    .replace(/\^\[([^\]]+)\]/g, '^{[$1]}')
    .replace(/([A-Za-z])_([A-Za-z0-9]+)(?![A-Za-z0-9{])/g, '$1_{$2}')
    .replace(/[−·×≈≥≤≠←→…–]/g, char => operators[char])
    .replace(/(?<![\\A-Za-z])(?:log|ln|exp|sin|cos|tan)(?=\()/g, name => `\\${name}`)
    .replace(/\bsize\b/g, '\\mathrm{size}')
    .replace(/√([A-Za-z]+|\d+(?:\.\d+)?)/g, '\\sqrt{$1}')
  if (!explicit) expression = expression.replace(/[가-힣]+/g, text => `\\text{${text}}`)
  return expression
}
