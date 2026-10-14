const version = new URL(import.meta.url).search;
const { calculateCeiling, DEFAULTS, decimal } = await import(`./calculation.js${version}`);
const { createPreview, renderPlan } = await import(`./preview.js${version}`);
const form = document.getElementById('ceiling-form');
const error = document.getElementById('input-error');
const resultRoot = document.getElementById('material-results');
const actionStatus = document.getElementById('action-status');
const actionButtons = [...document.querySelectorAll('.calc-actions button')];
const format = (n, digits = 2) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(n);
// Do not interpret old saved metre values as millimetres.
const storageKey = 'prostill.ceilingCalculator.v3';
let current = null;
let preview = null;
let previewTimer;
let pdfBusy = false;

function setView(next) {
  for (const view of ['3d', 'plan']) {
    document.getElementById(`panel-${view}`).hidden = next !== view;
    document.getElementById(`tab-${view}`).setAttribute('aria-selected', String(next === view));
  }
  document.getElementById('reset-camera').hidden = next !== '3d'; preview?.resize();
}
for (const next of ['3d', 'plan']) {
  document.getElementById(`tab-${next}`).addEventListener('click', () => setView(next));
  document.getElementById(`tab-${next}`).addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault(); const other = next === '3d' ? 'plan' : '3d';
      setView(other); document.getElementById(`tab-${other}`).focus();
    }
  });
}
function roomMode() {
  const areaMode = form.elements.namedItem('mode').value === 'area';
  document.getElementById('dimension-fields').hidden = areaMode;
  document.getElementById('area-fields').hidden = !areaMode;
  for (const name of ['length', 'width']) form.elements.namedItem(name).disabled = areaMode;
  form.elements.namedItem('area').disabled = !areaMode;
  document.getElementById('room-note').textContent = areaMode
    ? 'Предварительный расход по площади. 3D и схема — условный пример. Размеры и шаги — мм; площадь — м²; расход — пог.м.'
    : 'Раскладка по реальным размерам. Все размеры и шаги — мм; площадь — м²; расход — пог.м.';
  connectorFields();
}
function connectorFields() {
  const project = form.elements.namedItem('connectorMode').value === 'project';
  const needsRun = !project && form.elements.namedItem('mode').value === 'area';
  document.getElementById('connector-run-fields').hidden = !needsRun;
  document.getElementById('connector-quantity-fields').hidden = !project;
  form.elements.namedItem('connectorRun').disabled = !needsRun;
  form.elements.namedItem('connectorQuantity').disabled = !project;
  document.getElementById('connector-note').textContent = project
    ? 'Укажите итоговое количество из проекта, уже с запасом. Повторно запас не добавляется.'
    : needsRun ? 'Без длины линии количество не определяется. Можно оставить поле пустым и уточнить соединители по проекту.'
    : 'Один соединитель на стык двух заготовок. Тип и допустимость соединения уточняются по проекту.';
}
function readForm() { return Object.fromEntries(new FormData(form)); }
function save() { try { localStorage.setItem(storageKey, JSON.stringify(readForm())); } catch { /* Calculation does not require storage. */ } }
function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return;
    calculateCeiling(saved);
    for (const key of Object.keys(DEFAULTS)) if (key in saved && form.elements.namedItem(key)) form.elements.namedItem(key).value = saved[key];
  } catch { /* Invalid saved state must not prevent startup. */ }
}
function syncRanges() {
  for (const range of form.querySelectorAll('[data-range]')) {
    const value = decimal(form.elements.namedItem(range.dataset.range).value);
    if (Number.isFinite(value)) range.value = value;
  }
}
function linearCard(title, v) {
  return `<article class="calc-material"><h3>${title}</h3><p>К заказу</p><div class="calc-quantity">${format(v.orderPieces, 0)} <small>шт. × ${format(v.stockMm, 0)} мм</small></div><div class="calc-order">${format(v.purchasedLength)} пог.м в заготовках</div><p>Чистый расход: ${format(v.netLength)} пог.м<br>Расход с запасом: ${format(v.orderLength)} пог.м</p></article>`;
}
function pieceCard(title, v) {
  if (v.pending) return `<article class="calc-material"><h3>${title}</h3><div class="calc-quantity">Уточнить</div><p>Нужны длины линий рейки или количество из проекта.</p></article>`;
  const project = v.basis === 'project';
  const note = project ? 'Количество по проекту, запас включён' : v.basis === 'blanks' ? 'По заготовкам гребёнки' : v.estimated ? 'Оценка по длине линии' : 'По предварительной раскладке';
  return `<article class="calc-material"><h3>${title}</h3><p>К заказу${project ? ' · по проекту' : ' · с запасом'}</p><div class="calc-quantity">${format(v.orderPieces, 0)} <small>шт.</small></div><div class="calc-order">${note}</div>${project ? '' : `<p>Без запаса: ${format(v.netPieces, 0)} шт.</p>`}</article>`;
}
function showResult(r) {
  const { geometry: g, layout: l, materials: m, input: i } = r;
  document.querySelector('#mobile-summary span').textContent = `${format(g.area)} м² · К заказу ${format(m.slats.purchasedLength)} пог.м`;
  document.getElementById('geometry-summary').innerHTML = [
    ['Площадь', `${format(g.area)} м²`], ['Шаг по осям', `${format(l.pitchMm)} мм`],
    ['Рейка', `${format(i.slatStock, 0)} мм`], [g.estimated ? 'Метод' : 'Рядов реек', g.estimated ? 'По площади' : format(l.slatRows, 0)],
  ].map(([name, value]) => `<div><small>${name}</small><strong>${value}</strong></div>`).join('');
  document.getElementById('reserve-label').textContent = `Запас ${format(i.reserve)}%`;
  resultRoot.innerHTML = linearCard('Рейка', m.slats) + linearCard('Несущая гребёнка', m.stringers)
    + pieceCard('Подвесы', m.hangers) + pieceCard('Соединители рейки', m.connectors);
  document.getElementById('consumption-note').textContent = `Расход рейки: 1000 / ${format(l.pitchMm)} = ${format(r.coefficients.slatsPerSquareMeter, 3)} пог.м/м². ${g.estimated ? 'Расчёт по площади: метраж → целые заготовки → запас → округление вверх.' : 'Раскладка по размерам: целые ряды; заготовки на каждый ряд без повторного использования обрезков.'}`;
  const railMethod = g.estimated
    ? `Рейка: ${format(g.area)} м² × ${format(r.coefficients.slatsPerSquareMeter, 3)} пог.м/м² = ${format(m.slats.netLength)} пог.м. Гребёнка: ${format(g.area)} × 1000 / ${format(i.stringerSpacing, 0)} = ${format(m.stringers.netLength)} пог.м.`
    : `Рейка: ${l.slatRows} рядов × ${format(g.run * 1000, 0)} мм = ${format(m.slats.netLength)} пог.м. Гребёнки: ${l.stringerRows} линий × ${format(g.cross * 1000, 0)} мм; фактический шаг ≈ ${format(l.actualStringerSpacing, 0)} мм.`;
  const hangerMethod = g.estimated
    ? `Подвесы: ${m.hangers.perBlank} шт. на заготовку гребёнки ${format(i.stringerStock, 0)} мм при шаге до ${format(i.hangerSpacing, 0)} мм. К закупке ${m.stringers.orderPieces} заготовок × ${m.hangers.perBlank} = ${m.hangers.orderPieces} подвесов. Запас гребёнок уже учтён, повторного запаса нет.`
    : `Подвесы: ${l.stringerRows} линий × ${l.hangersPerStringer} шт. = ${m.hangers.netPieces} шт. Фактический шаг ≈ ${format(l.actualHangerSpacing, 0)} мм, крайний отступ — половина шага; запас добавляется отдельно.`;
  const connectorMethod = m.connectors.pending ? 'Соединители: количество не определяется по одной площади. Укажите длину линии или количество по проекту.'
    : m.connectors.basis === 'project' ? `Соединители: ${m.connectors.orderPieces} шт. по проекту, уже с запасом.`
    : `Соединители: ${m.connectors.rows} линий × ${m.connectors.jointsPerRow} стыков = ${m.connectors.netPieces} шт. без запаса. Один соединитель на стык; ${m.connectors.estimated ? 'линии оценочные, ' : ''}тип соединения согласуется по проекту.`;
  document.getElementById('calculation-method').innerHTML = `<ul>
    <li>${railMethod}</li><li>${hangerMethod}</li><li>${connectorMethod}</li>
    <li>Запас ${format(i.reserve)}% применяется к чистому метражу и к количеству целых заготовок. Сначала округляется количество заготовок без запаса, затем добавляется запас и снова округляется вверх. Поэтому закупочный метраж больше чистого расхода.</li>
    <li>${g.estimated ? 'Расход по площади — предварительная закупочная оценка; нужен монтажный проект и схема раскроя. Размеры условного квадрата в 3D не участвуют в расчёте расхода.' : 'Для каждого ряда считаются собственные заготовки, без повторного использования обрезков; схема раскроя может уменьшить расход.'} Соединители не добавляются к стоимости: цен в калькуляторе нет.</li>
  </ul>`;
  renderPlan(document.getElementById('ceiling-plan'), r);
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    if (!preview) preview = createPreview(document.getElementById('renderCanvas'), document.getElementById('preview-status'));
    if (preview) {
      preview.update(r);
      document.getElementById('preview-note').textContent = `Вращение — перетаскиванием, масштаб — колёсиком или двумя пальцами. ${g.estimated ? 'Условный пример: не реальная форма помещения. ' : ''}${g.length > 8 || g.width > 8 ? 'Показан фрагмент до 8000 × 8000 мм; расход — на всё помещение. ' : ''}Не монтажный чертёж.`;
    } else {
      setView('plan'); document.getElementById('preview-note').textContent = '3D недоступен. Расчёт и схема работают без WebGL.';
      document.getElementById('tab-3d').disabled = true;
    }
  }, 80);
}
function update() {
  for (const input of form.querySelectorAll('[aria-invalid]')) input.removeAttribute('aria-invalid');
  actionStatus.textContent = '';
  try {
    current = calculateCeiling(readForm()); error.hidden = true;
    actionButtons.forEach(b => b.disabled = pdfBusy && b.id === 'export-pdf'); showResult(current); save();
  } catch (e) {
    current = null; clearTimeout(previewTimer); error.hidden = false; error.textContent = e.message;
    document.querySelector('#mobile-summary span').textContent = 'Проверьте параметры';
    const field = form.elements.namedItem(e.field); if (field?.setAttribute) field.setAttribute('aria-invalid', 'true');
    resultRoot.innerHTML = ''; document.getElementById('geometry-summary').innerHTML = '';
    document.getElementById('consumption-note').textContent = 'Исправьте параметры. 3D сохраняет последний корректный вид.';
    document.getElementById('calculation-method').innerHTML = ''; actionButtons.forEach(b => b.disabled = true);
  }
}
form.addEventListener('submit', e => e.preventDefault());
form.addEventListener('input', e => {
  if (e.target.dataset.range) form.elements.namedItem(e.target.dataset.range).value = e.target.value;
  if (e.target.name === 'mode') {
    if (e.target.value === 'area' && current) form.elements.namedItem('area').value = current.geometry.area;
    roomMode();
  }
  if (e.target.name === 'connectorMode') connectorFields();
  syncRanges(); update();
});
document.getElementById('reset-calculator').addEventListener('click', () => { form.reset(); roomMode(); syncRanges(); update(); preview?.reset(); });
document.getElementById('reset-camera').addEventListener('click', () => preview?.reset());
function textCalculation() {
  if (!current) return '';
  const { geometry: g, layout: l, input: i, materials: m } = current;
  return ['PROSTILL · предварительная ведомость реечного потолка',
    `${g.estimated ? 'Расчёт по площади' : `Помещение ${format(i.length)} × ${format(i.width)} мм`}; площадь ${format(g.area)} м².`,
    `Рейка ${format(i.slatWidth)} × ${format(i.slatHeight)} мм; зазор ${format(i.gap)} мм; шаг ${format(l.pitchMm)} мм.`,
    `Направление: вдоль ${i.orientation === 'length' ? 'длины' : 'ширины'}. Запас ${format(i.reserve)}%.`,
    ...[['Рейка', m.slats], ['Гребёнка', m.stringers]].map(([name, v]) => `${name}: ${format(v.netLength)} пог.м; с запасом ${format(v.orderLength)} пог.м; к закупке ${v.orderPieces} шт. × ${format(v.stockMm, 0)} мм (${format(v.purchasedLength)} пог.м).`),
    `Шаг гребёнок ${format(i.stringerSpacing, 0)} мм; подвесов ${format(i.hangerSpacing, 0)} мм. Подвесы к заказу: ${m.hangers.orderPieces} шт.`,
    `Соединители: ${m.connectors.pending ? 'уточнить по проекту' : `${m.connectors.orderPieces} шт., ${m.connectors.basis === 'project' ? 'по проекту, запас включён' : 'по стыкам, с запасом'}`}.`,
    g.estimated ? 'Предварительный расход по площади; нужна схема раскроя.' : 'Без повторного использования обрезков. Нужна схема раскроя.',
    'Не монтажный проект. prostill.ru · info@prostill.ru · +7 (920) 278-02-01'].join('\n');
}
document.getElementById('copy-calculation').addEventListener('click', async () => {
  if (!current) return;
  const text = textCalculation();
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else {
      // The IP-based HTTP preview is not a secure Clipboard API origin.
      // Use a user-initiated legacy copy, with an explicit failure message.
      const area = document.createElement('textarea'); area.value = text;
      area.style.cssText = 'position:fixed;left:-9999px;top:0';
      area.setAttribute('readonly', ''); document.body.append(area); area.select();
      let copied;
      try { copied = document.execCommand('copy'); } finally { area.remove(); }
      if (!copied) throw new Error('Clipboard copy rejected');
    }
    actionStatus.textContent = 'Расчёт скопирован.';
  } catch { actionStatus.textContent = 'Браузер не разрешил копирование. Сохраните PDF или используйте печать.'; }
});
document.getElementById('print-calculation').addEventListener('click', () => { if (current) window.print(); });
document.getElementById('export-pdf').addEventListener('click', async () => {
  if (!current || pdfBusy) return;
  const snapshot = current, button = document.getElementById('export-pdf');
  pdfBusy = true; button.disabled = true; button.textContent = 'Готовим PDF…';
  actionStatus.textContent = 'Загружаем шрифт и создаём брендированную ведомость.';
  try {
    const { downloadCalculationPdf } = await import(`./pdf.js${version}`);
    await downloadCalculationPdf(snapshot);
    actionStatus.textContent = 'PDF сохранён. В нём логотип, параметры, допущения и контакты Prostill.';
  } catch {
    actionStatus.textContent = 'Не удалось сохранить PDF. Проверьте соединение и повторите или используйте печать.';
  } finally {
    pdfBusy = false; button.disabled = !current; button.textContent = 'Сохранить PDF';
  }
});
restore(); roomMode(); syncRanges(); update();
