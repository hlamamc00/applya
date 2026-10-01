import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { contactItems, mergedSkills, qualificationLines, type CvDocument } from "./cv";
import { monthLabel } from "./utils";

// Renders a CvDocument as a clean single-column A4 PDF: name and contact
// line, headline, summary, exams, skills, experience, education, extras.
// Text is wrapped and flows onto further pages as needed.

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = { top: 52, bottom: 52, left: 52, right: 52 };
const NAVY = rgb(0.055, 0.102, 0.227);
const GREEN = rgb(0.059, 0.663, 0.408);
const INK = rgb(0.12, 0.14, 0.18);
const GREY = rgb(0.38, 0.45, 0.48);
const RULE = rgb(0.86, 0.89, 0.9);

const WIDTH = A4.width - MARGIN.left - MARGIN.right;

class Writer {
  page!: PDFPage;
  y = 0;
  constructor(
    private doc: PDFDocument,
    private fonts: { regular: PDFFont; bold: PDFFont; serif: PDFFont },
  ) {
    this.newPage();
  }

  newPage() {
    this.page = this.doc.addPage([A4.width, A4.height]);
    this.y = A4.height - MARGIN.top;
  }

  ensure(height: number) {
    if (this.y - height < MARGIN.bottom) this.newPage();
  }

  wrap(text: string, font: PDFFont, size: number, width = WIDTH) {
    const lines: string[] = [];
    for (const paragraph of text.split(/\r?\n/)) {
      const words = paragraph.split(/\s+/).filter(Boolean);
      if (words.length === 0) {
        lines.push("");
        continue;
      }
      let line = "";
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) <= width) {
          line = candidate;
        } else {
          if (line) lines.push(line);
          line = word;
        }
      }
      lines.push(line);
    }
    return lines;
  }

  text(text: string, opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; x?: number; width?: number; lineHeight?: number; after?: number } = {}) {
    const font = opts.font ?? this.fonts.regular;
    const size = opts.size ?? 10;
    const lh = opts.lineHeight ?? size * 1.38;
    const x = opts.x ?? MARGIN.left;
    const lines = this.wrap(sanitize(text), font, size, opts.width ?? WIDTH - (x - MARGIN.left));
    for (const line of lines) {
      this.ensure(lh);
      this.page.drawText(line, { x, y: this.y - size, size, font, color: opts.color ?? INK });
      this.y -= lh;
    }
    this.y -= opts.after ?? 0;
  }

  /** A label on the left, text on the right, e.g. a date range beside a role. */
  row(left: string, right: string, opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; rightFont?: PDFFont; rightColor?: ReturnType<typeof rgb> } = {}) {
    const size = opts.size ?? 10;
    const lh = size * 1.38;
    const rightFont = opts.rightFont ?? this.fonts.regular;
    const rightWidth = rightFont.widthOfTextAtSize(right, size);
    this.ensure(lh);
    this.page.drawText(sanitize(left), { x: MARGIN.left, y: this.y - size, size, font: opts.font ?? this.fonts.bold, color: opts.color ?? INK });
    if (right) this.page.drawText(sanitize(right), { x: A4.width - MARGIN.right - rightWidth, y: this.y - size, size, font: rightFont, color: opts.rightColor ?? GREY });
    this.y -= lh;
  }

  heading(title: string) {
    this.ensure(34);
    this.y -= 10;
    this.page.drawText(title.toUpperCase(), { x: MARGIN.left, y: this.y - 9, size: 9, font: this.fonts.bold, color: NAVY });
    this.page.drawLine({ start: { x: MARGIN.left, y: this.y - 14 }, end: { x: A4.width - MARGIN.right, y: this.y - 14 }, thickness: 0.8, color: RULE });
    this.page.drawLine({ start: { x: MARGIN.left, y: this.y - 14 }, end: { x: MARGIN.left + 28, y: this.y - 14 }, thickness: 1.6, color: GREEN });
    this.y -= 24;
  }

  bullet(text: string, size = 10) {
    const lh = size * 1.38;
    const indent = 12;
    const lines = this.wrap(sanitize(text), this.fonts.regular, size, WIDTH - indent);
    lines.forEach((line, i) => {
      this.ensure(lh);
      if (i === 0) this.page.drawText("•", { x: MARGIN.left + 2, y: this.y - size, size, font: this.fonts.regular, color: GREEN });
      this.page.drawText(line, { x: MARGIN.left + indent, y: this.y - size, size, font: this.fonts.regular, color: INK });
      this.y -= lh;
    });
  }

  space(h: number) {
    this.y -= h;
  }
}

/** WinAnsi can't show every character; swap the common ones the standard fonts lack. */
function sanitize(text: string) {
  return text
    .replace(/[‘’‚]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/–/g, "–")
    .replace(/—/g, "—")
    .replace(/…/g, "...")
    .replace(/[•●]/g, "•")
    .replace(/[^\x00-\x7F -ÿ–—•€]/g, "");
}

/** A bold label followed by text that wraps under itself, e.g. "Technology: Python, R, SQL". */
function labelledLine(w: Writer, fonts: { regular: PDFFont; bold: PDFFont }, label: string, text: string, size = 10) {
  const labelWidth = label ? fonts.bold.widthOfTextAtSize(sanitize(label), size) + 2 : 0;
  const lines = w.wrap(sanitize(text), fonts.regular, size, WIDTH - labelWidth);
  lines.forEach((line, i) => {
    w.ensure(size * 1.38);
    if (i === 0 && label) w.page.drawText(sanitize(label), { x: MARGIN.left, y: w.y - size, size, font: fonts.bold, color: INK });
    w.page.drawText(line, { x: MARGIN.left + labelWidth, y: w.y - size, size, font: fonts.regular, color: INK });
    w.y -= size * 1.38;
  });
}

export async function renderCvPdf(cv: CvDocument): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${cv.name} – CV`);
  doc.setAuthor(cv.name);
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    serif: await doc.embedFont(StandardFonts.TimesRomanBold),
  };
  const w = new Writer(doc, fonts);

  // Name and contact line.
  w.text(cv.name, { font: fonts.serif, size: 24, color: NAVY, lineHeight: 28 });
  if (cv.headline) w.text(cv.headline, { size: 11, color: GREEN, font: fonts.bold, lineHeight: 15 });
  const contact = contactItems(cv).join("  ·  ");
  if (contact) w.text(contact, { size: 9, color: GREY, lineHeight: 13 });
  w.space(4);

  if (cv.summary) {
    w.heading("Profile");
    w.text(cv.summary, { size: 10, after: 2 });
  }

  // Exams on one line per awarding body, codes only and no dates, to keep the CV short.
  const quals = qualificationLines(cv);
  if (quals.length) {
    w.heading("Professional qualifications");
    for (const q of quals) labelledLine(w, fonts, `${q.body}: `, q.parts.join("  ·  "));
    w.space(2);
  }

  const skills = mergedSkills(cv.skills);
  if (skills.length) {
    w.heading("Skills");
    for (const g of skills) labelledLine(w, fonts, g.group ? `${g.group}: ` : "", g.items.join(", "));
  }

  if (cv.experience.length) {
    w.heading("Experience");
    for (const e of cv.experience) {
      const dates = [monthLabel(e.start), e.current ? "Present" : monthLabel(e.end)].filter(Boolean).join(" – ");
      w.row(e.title, dates, { size: 10.5 });
      const sub = [e.employer, e.location].filter(Boolean).join(", ");
      if (sub) w.text(sub, { size: 9.5, color: GREY, lineHeight: 13 });
      for (const b of e.bullets) w.bullet(b, 9.8);
      w.space(6);
    }
  }

  if (cv.education.length) {
    w.heading("Education");
    for (const e of cv.education) {
      const dates = [e.start, e.end].filter(Boolean).join(" – ");
      w.row(e.qualification || e.institution, dates, { size: 10.5 });
      const sub = [e.qualification ? e.institution : "", e.grade].filter(Boolean).join(" · ");
      if (sub) w.text(sub, { size: 9.5, color: GREY, lineHeight: 13 });
      if (e.notes) w.text(e.notes, { size: 9.5, lineHeight: 13 });
      w.space(5);
    }
  }

  for (const s of cv.extraSections) {
    w.heading(s.title);
    for (const item of s.items) w.bullet(item, 9.8);
  }

  return doc.save();
}
