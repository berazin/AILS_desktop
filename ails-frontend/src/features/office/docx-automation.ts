import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, Header, Footer, patchDocument, PatchType } from 'docx'

export async function generateDocx(paragraphs: string[], rows: string[][] = [], options: { header?: string; footer?: string } = {}) {
  const children: (Paragraph | Table)[] = paragraphs.map(text => new Paragraph({ children: [new TextRun(text)] }))
  if (rows.length) children.push(new Table({ rows: rows.map(row => new TableRow({ children: row.map(text => new TableCell({ children: [new Paragraph(text)] })) })) }))
  return new Uint8Array(await (await Packer.toBlob(new Document({ sections: [{ children,
    headers: options.header ? { default: new Header({ children: [new Paragraph(options.header)] }) } : undefined,
    footers: options.footer ? { default: new Footer({ children: [new Paragraph(options.footer)] }) } : undefined,
  }] }))).arrayBuffer())
}
export async function patchDocxTemplate(bytes: Uint8Array, replacements: Record<string, string>) {
  return patchDocument(bytes, { patches: Object.fromEntries(Object.entries(replacements).map(([key, text]) => [key, { type: PatchType.PARAGRAPH, children: [new TextRun(text)] }])) })
}
