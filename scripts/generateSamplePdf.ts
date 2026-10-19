/**
 * Generates public/sample/sample-clinic.pdf — a vector floor plan of the
 * fictional sample clinic at 1/8" = 1'-0" on an ARCH D (36" x 24") sheet.
 * The drawing is derived from src/sample/sampleClinic.ts so that drawing and
 * spatial model coincide exactly once calibrated.
 *
 * Run: npm run generate:sample-pdf
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { PDFDocument, StandardFonts, rgb, LineCapStyle } from 'pdf-lib';
import { SAMPLE_PDF, sampleSpatialModel } from '../src/sample/sampleClinic';
import { deriveWalls } from '../src/geometry/walls';
import { closestOnSegment } from '../src/geometry/vec';
import { centroid, pointInPolygon } from '../src/geometry/polygon';
import type { Vec2 } from '../src/domain/types';

const spatial = sampleSpatialModel();
const { pageWidth: W, pageHeight: H, metersPerPoint: mpp, originSheet } = SAMPLE_PDF;

const toPdf = (p: Vec2) => ({ x: originSheet.x + p.x / mpp, y: H - (originSheet.y + p.y / mpp) });

async function main() {
  const doc = await PDFDocument.create();
  doc.setTitle('Sample Ambulatory Clinic — Fictional Demonstration Plan');
  doc.setCreator('BSA Flow Explorer sample generator');
  const page = doc.addPage([W, H]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.13, 0.14, 0.15);
  const light = rgb(0.55, 0.56, 0.57);

  // Sheet border and title block.
  page.drawRectangle({ x: 36, y: 36, width: W - 72, height: H - 72, borderColor: ink, borderWidth: 1.2 });
  page.drawRectangle({ x: W - 36 - 360, y: 36, width: 360, height: 150, borderColor: ink, borderWidth: 1 });
  const tb = (t: string, x: number, y: number, size: number, f = font, c = ink) => page.drawText(t, { x, y, size, font: f, color: c });
  tb('SAMPLE AMBULATORY CLINIC', W - 380, 150, 16, bold);
  tb('Level 1 — Clinic Suite Floor Plan', W - 380, 130, 11);
  tb('FICTIONAL LAYOUT FOR DEMONSTRATION ONLY', W - 380, 106, 9, bold);
  tb('Not a real facility. Not a validated design.', W - 380, 92, 9);
  tb('SCALE: 1/8" = 1\'-0"   (ARCH D)', W - 380, 66, 10);
  tb('BSA Flow Explorer — sample drawing', W - 380, 50, 8, font, light);

  // Floor grid lines (light) every 20 ft.
  const ft = 0.3048;
  for (let x = 0; x <= 46 + 1e-6; x += 20 * ft) {
    const a = toPdf({ x, y: -1.2 });
    const b = toPdf({ x, y: 19.6 });
    page.drawLine({ start: a, end: b, thickness: 0.3, color: rgb(0.8, 0.8, 0.8), dashArray: [6, 4] });
  }

  // Obstacles (casework).
  for (const o of spatial.obstacles) {
    const pts = o.polygon.map(toPdf);
    for (let i = 0; i < pts.length; i++) page.drawLine({ start: pts[i], end: pts[(i + 1) % pts.length], thickness: 0.8, color: ink });
  }

  // Walls.
  for (const w of deriveWalls(spatial)) {
    page.drawLine({ start: toPdf(w.a), end: toPdf(w.b), thickness: 3.2, color: ink, lineCap: LineCapStyle.Projecting });
  }

  // Door leaves and swings, opening into the room (not the corridor).
  for (const d of spatial.doors) {
    let best: { a: Vec2; b: Vec2; dd: number } | null = null;
    for (const r of [...spatial.rooms.map((r) => r.polygon), ...spatial.circulation.map((c) => c.polygon)]) {
      for (let i = 0; i < r.length; i++) {
        const c = closestOnSegment(d.position, r[i], r[(i + 1) % r.length]);
        if (!best || c.d < best.dd) best = { a: r[i], b: r[(i + 1) % r.length], dd: c.d };
      }
    }
    if (!best || d.widthM > 2) continue; // wide openings drawn as plain gaps
    const L = Math.hypot(best.b.x - best.a.x, best.b.y - best.a.y);
    const u = { x: (best.b.x - best.a.x) / L, y: (best.b.y - best.a.y) / L };
    let nrm = { x: -u.y, y: u.x };
    const into = { x: d.position.x + nrm.x * 0.3, y: d.position.y + nrm.y * 0.3 };
    const intoRoom = spatial.rooms.some((r) => pointInPolygon(into, r.polygon));
    if (!intoRoom) nrm = { x: -nrm.x, y: -nrm.y };
    const hinge = { x: d.position.x - (u.x * d.widthM) / 2, y: d.position.y - (u.y * d.widthM) / 2 };
    const leafEnd = { x: hinge.x + nrm.x * d.widthM, y: hinge.y + nrm.y * d.widthM };
    page.drawLine({ start: toPdf(hinge), end: toPdf(leafEnd), thickness: 0.9, color: ink });
    const arc: Vec2[] = [];
    for (let k = 0; k <= 16; k++) {
      const a = (k / 16) * (Math.PI / 2);
      arc.push({
        x: hinge.x + d.widthM * (Math.cos(a) * nrm.x + Math.sin(a) * u.x),
        y: hinge.y + d.widthM * (Math.cos(a) * nrm.y + Math.sin(a) * u.y),
      });
    }
    for (let k = 1; k < arc.length; k++) page.drawLine({ start: toPdf(arc[k - 1]), end: toPdf(arc[k]), thickness: 0.4, color: light });
  }

  // Room labels.
  for (const r of spatial.rooms) {
    const c = toPdf(centroid(r.polygon));
    const name = r.name.toUpperCase();
    const s1 = 7.5;
    const w1 = bold.widthOfTextAtSize(name, s1);
    const label = r.id === 'room-ns' ? { x: c.x, y: c.y + 30 } : c;
    page.drawText(name, { x: label.x - w1 / 2, y: label.y + 2, size: s1, font: bold, color: ink });
    const w2 = font.widthOfTextAtSize(r.number, 7);
    page.drawText(r.number, { x: label.x - w2 / 2, y: label.y - 8, size: 7, font, color: light });
  }
  for (const c of spatial.circulation) {
    const p = toPdf(centroid(c.polygon));
    const t = c.name.toUpperCase();
    if (c.id === 'circ-west' || c.id === 'circ-east') continue;
    page.drawText(t, { x: p.x - font.widthOfTextAtSize(t, 6.5) / 2, y: p.y - 2, size: 6.5, font, color: light });
  }

  // Overall dimension string (used as the calibration reference: 150'-11").
  const dA = toPdf(SAMPLE_PDF.calibrationWorldA);
  const dB = toPdf(SAMPLE_PDF.calibrationWorldB);
  page.drawLine({ start: dA, end: dB, thickness: 0.6, color: ink });
  for (const p of [dA, dB]) {
    page.drawLine({ start: { x: p.x, y: p.y - 6 }, end: { x: p.x, y: p.y + 26 }, thickness: 0.5, color: ink });
    page.drawLine({ start: { x: p.x - 4, y: p.y - 4 }, end: { x: p.x + 4, y: p.y + 4 }, thickness: 1.2, color: ink });
  }
  const totalFt = 46 / ft;
  const feet = Math.floor(totalFt);
  const inches = Math.round((totalFt - feet) * 12);
  const dimText = `${feet}'-${inches}"  (46.0 m)`;
  page.drawText(dimText, { x: (dA.x + dB.x) / 2 - font.widthOfTextAtSize(dimText, 9) / 2, y: dA.y + 5, size: 9, font, color: ink });

  // North arrow.
  const na = { x: 140, y: H - 140 };
  page.drawCircle({ x: na.x, y: na.y, size: 22, borderColor: ink, borderWidth: 0.8 });
  page.drawLine({ start: { x: na.x, y: na.y - 18 }, end: { x: na.x, y: na.y + 18 }, thickness: 1.4, color: ink });
  page.drawText('N', { x: na.x - 4, y: na.y + 26, size: 11, font: bold, color: ink });

  // Graphic scale bar 0-8-16-32 ft.
  const sb = { x: 100, y: 90 };
  const ptPerFt = ft / mpp;
  [0, 8, 16, 32].forEach((v, i, arr) => {
    if (i < arr.length - 1) {
      page.drawRectangle({ x: sb.x + v * ptPerFt, y: sb.y, width: (arr[i + 1] - v) * ptPerFt, height: 5, color: i % 2 ? rgb(1, 1, 1) : ink, borderColor: ink, borderWidth: 0.5 });
    }
    page.drawText(`${v}'`, { x: sb.x + v * ptPerFt - 3, y: sb.y + 9, size: 7, font, color: ink });
  });

  mkdirSync('public/sample', { recursive: true });
  writeFileSync('public/sample/sample-clinic.pdf', await doc.save());
  console.log('Wrote public/sample/sample-clinic.pdf');
}

main();
