// CommonMark's seven HTML block forms. Used only when callers explicitly allow source HTML.
const blockTag =
  /^ {0,3}<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|source|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[ \t]|\/?\s*>|$)/i
const completeTag =
  /^ {0,3}(?:<\/[A-Za-z][A-Za-z0-9-]*\s*>|<[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][A-Za-z0-9_.:-]*(?:\s*=\s*(?:[^ \t\n\r"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*\/?>)[ \t]*$/

export function htmlBlock(line: string): { end?: RegExp; interrupts: boolean } | undefined {
  if (/^ {0,3}<(?:script|pre|style|textarea)(?:[ \t>]|$)/i.test(line))
    return { end: /<\/(?:script|pre|style|textarea)>/i, interrupts: true }
  if (/^ {0,3}<!--/.test(line)) return { end: /-->/, interrupts: true }
  if (/^ {0,3}<\?/.test(line)) return { end: /\?>/, interrupts: true }
  if (/^ {0,3}<![A-Z]/.test(line)) return { end: />/, interrupts: true }
  if (/^ {0,3}<!\[CDATA\[/.test(line)) return { end: /\]\]>/, interrupts: true }
  if (blockTag.test(line)) return { interrupts: true }
  if (completeTag.test(line)) return { interrupts: false }
  return undefined
}
