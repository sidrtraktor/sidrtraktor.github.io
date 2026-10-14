// Client-side PDF: no customer parameters are sent to a server or external API.
const format = (n, digits = 2) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(n);
const COLORS = { dark: [23, 25, 28], accent: [232, 86, 28], muted: [98, 104, 111], light: [238, 240, 242], line: [222, 225, 229] };
let assetsPromise;
const assetUrl = file => {
  const url = new URL(file, import.meta.url); url.search = new URL(import.meta.url).search; return url.href;
};
async function binaryFont(file) {
  const response = await fetch(assetUrl(`./pdf-assets/${file}`));
  if (!response.ok) throw new Error('PDF font unavailable');
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}
function pdfLibrary() {
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timeout = setTimeout(() => { script.remove(); reject(new Error('PDF library timeout')); }, 20000);
    script.src = assetUrl('./vendor/jspdf-4.2.1.umd.min.js');
    script.onload = () => { clearTimeout(timeout); window.jspdf?.jsPDF ? resolve(window.jspdf.jsPDF) : reject(new Error('PDF library unavailable')); };
    script.onerror = () => { clearTimeout(timeout); script.remove(); reject(new Error('PDF library unavailable')); };
    document.head.append(script);
  });
}
function logoImage() {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas'); canvas.width = 1521; canvas.height = 309;
        const context = canvas.getContext('2d'); context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      } catch (error) { reject(error); }
    };
    image.onerror = () => reject(new Error('Brand logo unavailable'));
    image.src = assetUrl('../images/logo-prostill-light.svg');
  });
}
async function loadAssets() {
  if (!assetsPromise) assetsPromise = Promise.all([pdfLibrary(), binaryFont('Manrope-Regular.ttf'), binaryFont('Manrope-Bold.ttf'), logoImage()])
    .then(([jsPDF, regular, bold, logo]) => ({ jsPDF, regular, bold, logo }))
    .catch(error => { assetsPromise = null; throw error; });
  return assetsPromise;
}

export function calculationReference(r, date = new Date()) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date).replaceAll('-', '');
  let hash = 2166136261;
  for (const char of JSON.stringify(r.input)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return `PS-${day}-${hash.toString(16).toUpperCase().padStart(8, '0')}`;
}

export function createCalculationPdf(jsPDF, r, assets, { date = new Date(), sourceUrl = '' } = {}) {
  const { input: i, geometry: g, materials: m, layout: l } = r;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true, putOnlyUsedFonts: true });
  for (const [style, bytes] of [['normal', assets.regular], ['bold', assets.bold]]) {
    const file = `Manrope-${style}.ttf`; doc.addFileToVFS(file, bytes); doc.addFont(file, 'Manrope', style);
  }
  const reference = calculationReference(r, date);
  doc.setProperties({ title: `PROSTILL - расчёт потолка ${reference}`, subject: 'Предварительная ведомость материалов реечного потолка', author: 'ООО ПРО Проекты - Prostill', creator: 'prostill.ru', keywords: 'Prostill, потолочные системы, расчёт, ведомость' });
  doc.setCreationDate(date);
  function text(value, x, y, size = 10, bold = false, color = COLORS.dark, options = {}) {
    doc.setFont('Manrope', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(...color); doc.text(String(value), x, y, options);
  }
  function wrapped(value, x, y, width, size = 9, color = COLORS.muted, lineHeight = 4) {
    doc.setFont('Manrope', 'normal'); doc.setFontSize(size); doc.setTextColor(...color);
    const lines = doc.splitTextToSize(value, width); doc.text(lines, x, y, { lineHeightFactor: lineHeight / (size * 0.352778) }); return y + lines.length * lineHeight;
  }
  doc.setFillColor(...COLORS.dark); doc.rect(0, 0, 210, 35, 'F');
  doc.addImage(assets.logo, 'PNG', 16, 11, 70, 14.22);
  text('prostill.ru', 194, 13, 12, true, [255, 255, 255], { align: 'right' });
  doc.link(166, 8, 28, 6, { url: 'https://prostill.ru/' });
  text('+7 (920) 278-02-01', 194, 20, 9, false, [255, 255, 255], { align: 'right' });
  text('info@prostill.ru', 194, 26, 9, false, [255, 255, 255], { align: 'right' });
  doc.setFillColor(...COLORS.accent); doc.rect(0, 35, 210, 1.5, 'F');
  text('Ведомость материалов', 16, 49, 19, true);
  text('Реечный потолок / предварительный расчёт', 16, 57, 10, false, COLORS.muted);
  text(reference, 16, 65, 8, true, COLORS.accent);
  text(new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric' }).format(date), 194, 65, 8, false, COLORS.muted, { align: 'right' });

  const parameters = [
    ['Метод расчёта', g.estimated ? 'По площади' : 'По размерам помещения'],
    ['Площадь', `${format(g.area)} м²`],
    [g.estimated ? 'Размеры помещения' : 'Длина × ширина', g.estimated ? 'Не заданы' : `${format(i.length)} × ${format(i.width)} мм`],
    ['Профиль рейки', `${format(i.slatWidth)} × ${format(i.slatHeight)} мм`],
    ['Чистый зазор / шаг по осям', `${format(i.gap)} / ${format(l.pitchMm)} мм`],
    ['Заготовка рейки / гребёнки', `${format(i.slatStock, 0)} / ${format(i.stringerStock, 0)} мм`],
    ['Шаг гребёнок / подвесов', `${format(i.stringerSpacing, 0)} / ${format(i.hangerSpacing, 0)} мм`],
    ['Запас на материалы', `${format(i.reserve)}%`],
    ['Направление реек', g.estimated ? 'Уточняется по проекту' : `Вдоль ${i.orientation === 'length' ? 'длины' : 'ширины'}`],
    ['Отделка', i.color === 'wood' ? 'Под дерево (пример)' : `RAL ${i.color}`],
  ];
  doc.setFillColor(...COLORS.light); doc.roundedRect(16, 72, 178, 57, 2, 2, 'F');
  parameters.forEach(([name, value], n) => {
    const x = 21 + (n % 2) * 87, y = 80 + Math.floor(n / 2) * 10.5;
    text(name, x, y, 7.5, false, COLORS.muted); text(value, x, y + 4.2, 9.2, true);
  });
  const columns = [16, 71, 110, 150, 174, 194];
  doc.setFillColor(...COLORS.dark); doc.roundedRect(16, 137, 178, 12, 1.5, 1.5, 'F');
  const headings = ['Материал', 'Без запаса', 'С запасом', 'К заказу,\nшт.', 'Длина,\nмм'];
  headings.forEach((heading, n) => {
    doc.setFont('Manrope', 'bold'); doc.setFontSize(8); doc.setTextColor(255, 255, 255);
    doc.text(heading.split('\n'), columns[n] + 3, 142, { lineHeightFactor: 1.1 });
  });
  const connectorSource = m.connectors.pending ? 'Уточнить' : m.connectors.basis === 'project' ? 'По проекту' : `${format(m.connectors.netPieces, 0)} шт.`;
  const rows = [
    ['Рейка', `${format(m.slats.netLength)} пог.м`, `${format(m.slats.orderLength)} пог.м`, format(m.slats.orderPieces, 0), format(m.slats.stockMm, 0)],
    ['Несущая гребёнка', `${format(m.stringers.netLength)} пог.м`, `${format(m.stringers.orderLength)} пог.м`, format(m.stringers.orderPieces, 0), format(m.stringers.stockMm, 0)],
    ['Подвесы', `${format(m.hangers.netPieces, 0)} шт.`, `${format(m.hangers.orderPieces, 0)} шт.`, format(m.hangers.orderPieces, 0), '-'],
    ['Соединители рейки', connectorSource, m.connectors.pending ? 'Уточнить' : `${format(m.connectors.orderPieces, 0)} шт.`, m.connectors.pending ? '-' : format(m.connectors.orderPieces, 0), '-'],
  ];
  rows.forEach((row, rowIndex) => {
    const y = 149 + rowIndex * 13;
    if (rowIndex % 2 === 0) { doc.setFillColor(...COLORS.light); doc.rect(16, y, 178, 13, 'F'); }
    row.forEach((value, column) => {
      doc.setFont('Manrope', column === 0 || column === 3 ? 'bold' : 'normal'); doc.setFontSize(column === 0 ? 8.5 : 8);
      doc.setTextColor(...COLORS.dark);
      doc.text(doc.splitTextToSize(value, columns[column + 1] - columns[column] - 5), columns[column] + 3, y + 6, { lineHeightFactor: 1.2 });
    });
  });
  text(`К закупке: рейка ${format(m.slats.purchasedLength)} пог.м; гребёнка ${format(m.stringers.purchasedLength)} пог.м.`, 16, 208, 9, true, COLORS.accent);
  let y = 218;
  text('Что учтено', 16, y, 10, true); y += 6;
  const notes = [
    g.estimated ? 'По площади: метраж округляется до целых заготовок, затем добавляется запас и количество снова округляется вверх. Схема раскроя не рассчитана.' : 'По размерам: целые ряды и заготовки для каждого ряда. Повторное использование обрезков не учтено. Схема раскроя может уменьшить расход.',
    m.hangers.basis === 'blanks' ? `Подвесы: ${m.hangers.perBlank} шт. на заготовку гребёнки, включая запасные заготовки. Повторный запас не добавляется.` : 'Подвесы рассчитаны по предварительной раскладке. Шаги и отступы необходимо согласовать с проектировщиком.',
    m.connectors.pending ? 'Соединители нужно уточнить: по одной площади без длин линий количество не определяется.' : m.connectors.basis === 'project' ? 'Соединители указаны по проекту, уже с запасом. Их количество не рассчитано автоматически.' : `Соединители: один на стык двух заготовок${m.connectors.estimated ? '; линии оценочные' : ''}. Тип и допустимость стыков уточняются по проекту.`,
    'Не монтажный проект и не коммерческое предложение. Не учтены проёмы, светильники и несущая способность основания. Цены не приводятся.',
  ];
  for (const note of notes) y = wrapped(note, 16, y, 178, 8, COLORS.muted, 3.6) + 2;
  if (y > 266) throw new Error('PDF notes exceed one page');
  doc.setDrawColor(...COLORS.line); doc.line(16, 269, 194, 269);
  text('ООО «ПРО Проекты» / ИНН 9721250620 / ОГРН 1257700195642', 16, 275, 8, true);
  text('prostill.ru / info@prostill.ru / +7 (920) 278-02-01', 16, 281, 8, false, COLORS.muted);
  if (sourceUrl) wrapped(`Источник расчёта: ${sourceUrl}`, 16, 287, 178, 7, COLORS.muted, 3);
  doc.link(16, 277, 19, 5, { url: 'https://prostill.ru/' });
  return { doc, reference };
}

export async function downloadCalculationPdf(r) {
  const assets = await loadAssets();
  const { doc, reference } = createCalculationPdf(assets.jsPDF, r, assets, { sourceUrl: `${location.origin}${location.pathname}` });
  const blob = doc.output('blob'), url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = `prostill-calculation-${reference}.pdf`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
