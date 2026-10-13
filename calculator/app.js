const version = new URL(import.meta.url).search;
const { calculateCeiling, DEFAULTS, decimal } = await import(`./calculation.js${version}`);
const { createPreview, renderPlan } = await import(`./preview.js${version}`);
const form = document.getElementById('ceiling-form');
const error = document.getElementById('input-error');
const resultRoot = document.getElementById('material-results');
const actionStatus = document.getElementById('action-status');
const actionButtons = [...document.querySelectorAll('.calc-actions button')];
const format = (n, digits = 2) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(n);
const storageKey = 'prostill.ceilingCalculator.v2';
let current = null;
let preview = null;
let previewTimer;

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
  for (const name of ['area', 'ratio']) form.elements.namedItem(name).disabled = !areaMode;
  document.getElementById('room-note').textContent = areaMode
    ? 'Размеры и периметр оценочные. При соотношении 1 принимается квадратное помещение; для точного периметра выберите «По размерам».'
    : 'Для точного периметра задайте длину и ширину.';
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
  return `<article class="calc-material"><h3>${title}</h3><div class="calc-quantity">${format(v.netLength)} <small>пог.м</small></div><p>С запасом: ${format(v.orderLength)} пог.м</p><div class="calc-order">К закупке: ${format(v.orderPieces, 0)} шт. × ${format(v.stockLength)} м<br>${format(v.purchasedLength)} пог.м в заготовках</div></article>`;
}
function pieceCard(title, v) {
  return `<article class="calc-material"><h3>${title}</h3><div class="calc-quantity">${format(v.netPieces, 0)} <small>шт.</small></div><p>По предварительной схеме</p><div class="calc-order">С запасом: ${format(v.orderPieces, 0)} шт.</div></article>`;
}
function showResult(r) {
  const { geometry: g, layout: l, materials: m, input: i } = r;
  document.querySelector('#mobile-summary span').textContent = `${format(g.area)} м² · Рейка ${format(m.slats.netLength)} пог.м`;
  document.getElementById('geometry-summary').innerHTML = [
    ['Площадь', `${format(g.area)} м²`], [g.estimated ? 'Периметр ≈' : 'Периметр', `${format(g.perimeter)} м`],
    ['Шаг по осям', `${format(l.pitchMm)} мм`], ['Рядов реек', format(l.slatRows, 0)],
  ].map(([name, value]) => `<div><small>${name}</small><strong>${value}</strong></div>`).join('');
  document.getElementById('reserve-label').textContent = `Запас ${format(i.reserve)}%`;
  resultRoot.innerHTML = linearCard('Рейка', m.slats) + linearCard('Несущая гребёнка', m.stringers)
    + linearCard('Пристенный уголок', m.wallAngle) + pieceCard('Подвесы', m.hangers) + pieceCard('Крепёж уголка · оценка', m.wallFixings);
  document.getElementById('consumption-note').textContent = `Теоретический расход рейки: 1000 / ${format(l.pitchMm)} = ${format(r.coefficients.slatsPerSquareMeter, 3)} пог.м/м². Ведомость учитывает целые ряды. ${g.estimated ? `Оценочное помещение: ${format(g.length)} × ${format(g.width)} м.` : ''}`;
  document.getElementById('calculation-method').innerHTML = `<ul>
    <li>Рейка: ${l.slatRows} рядов × ${format(g.run)} м = ${format(m.slats.netLength)} пог.м. Зазор ${format(i.gap)} мм, ширина ${format(i.slatWidth)} мм. Ряды центрируются, отступ от стен ≈ ${format(l.edgeMargin * 1000)} мм.</li>
    <li>Гребёнки: ${l.stringerRows} линий × ${format(g.cross)} м. Линии распределены равномерно, их не менее двух. Фактический шаг ≈ ${format(l.actualStringerSpacing)} м, отступ от края — половина шага.</li>
    <li>Подвесы: ${l.stringerRows} линий × ${l.hangersPerStringer} шт. = ${m.hangers.netPieces} шт. Фактический шаг ≈ ${format(l.actualHangerSpacing, 3)} м (не больше заданных ${format(i.hangerSpacing)} м), крайний отступ — половина шага.</li>
    <li>Уголок: 2 × (${format(g.length)} + ${format(g.width)}) = ${format(g.perimeter)} пог.м. Крепёж оценивается отдельно по каждой стене с точками у концов.</li>
    <li>Запас ${format(i.reserve)}% прибавляется к метражу и заготовкам. Штучные позиции округляются вверх. Обрезки не используются повторно: для каждого ряда и каждой стены считаются собственные заготовки.</li>
    <li>Если пролёт длиннее заготовки, предполагаются стыки. Их допустимость и дополнительные соединители нужно согласовать; соединители не учтены.</li>
    ${g.estimated ? '<li>Площадь задаёт оценочный прямоугольник. Одинаковая площадь не определяет реальный периметр.</li>' : ''}
  </ul>`;
  renderPlan(document.getElementById('ceiling-plan'), r);
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    if (!preview) preview = createPreview(document.getElementById('renderCanvas'), document.getElementById('preview-status'));
    if (preview) {
      preview.update(r);
      document.getElementById('preview-note').textContent = `Вращение — перетаскиванием, масштаб — колёсиком или двумя пальцами. ${g.length > 8 || g.width > 8 ? '3D показывает фрагмент до 8 × 8 м; ведомость рассчитана на всё помещение. ' : ''}Схема не является монтажным чертежом.`;
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
    actionButtons.forEach(b => b.disabled = false); showResult(current); save();
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
  syncRanges(); update();
});
document.getElementById('reset-calculator').addEventListener('click', () => { form.reset(); roomMode(); syncRanges(); update(); preview?.reset(); });
document.getElementById('reset-camera').addEventListener('click', () => preview?.reset());
function textCalculation() {
  if (!current) return '';
  const { geometry: g, layout: l, input: i, materials: m } = current;
  return ['PROSTILL · предварительная ведомость реечного потолка',
    `Помещение: ${format(g.length)} × ${format(g.width)} м; площадь ${format(g.area)} м²; периметр ${format(g.perimeter)} м${g.estimated ? ' (оценочно)' : ''}.`,
    `Рейка ${format(i.slatWidth)} × ${format(i.slatHeight)} мм; зазор ${format(i.gap)} мм; шаг ${format(l.pitchMm)} мм.`,
    `Направление: вдоль ${i.orientation === 'length' ? 'длины' : 'ширины'}. Запас ${format(i.reserve)}%.`,
    ...[['Рейка', m.slats], ['Гребёнка', m.stringers], ['Пристенный уголок', m.wallAngle]].map(([name, v]) => `${name}: ${format(v.netLength)} пог.м; с запасом ${format(v.orderLength)} пог.м; к закупке ${v.orderPieces} шт. × ${v.stockLength} м.`),
    `Подвесы: ${m.hangers.netPieces} шт.; с запасом ${m.hangers.orderPieces} шт.; шаг до ${format(i.hangerSpacing)} м вдоль гребёнки.`,
    `Крепёж уголка (оценка): ${m.wallFixings.netPieces} шт.; с запасом ${m.wallFixings.orderPieces} шт.`,
    'Обрезки не используются повторно. Соединители не учтены. Шаги и стыки согласуются по проекту.',
    'Не монтажный проект. info@prostill.ru · +7 (920) 278-02-01'].join('\n');
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
  } catch { actionStatus.textContent = 'Браузер не разрешил копирование. Используйте CSV или печать.'; }
});
document.getElementById('print-calculation').addEventListener('click', () => { if (current) window.print(); });
document.getElementById('export-csv').addEventListener('click', () => {
  if (!current) return;
  const { geometry: g, materials: m, input: i, layout: l } = current;
  const rows = [['PROSTILL', 'Предварительная ведомость, не монтажный проект'],
    ['Помещение, м', `${format(g.length)} × ${format(g.width)}`], ['Площадь, м²', format(g.area)],
    [g.estimated ? 'Периметр (оценочно), м' : 'Периметр, м', format(g.perimeter)],
    ['Ширина / высота рейки, мм', `${i.slatWidth} / ${i.slatHeight}`], ['Зазор, мм', i.gap], ['Шаг по осям, мм', l.pitchMm],
    ['Направление', i.orientation === 'length' ? 'Вдоль длины' : 'Вдоль ширины'], ['Запас, %', i.reserve],
    ['Шаг гребёнок / подвесов / крепежа уголка, м', `${i.stringerSpacing} / ${i.hangerSpacing} / ${i.fixingSpacing}`],
    [], ['Материал', 'Чистый метраж, пог.м', 'Метраж с запасом, пог.м', 'К закупке, шт.', 'Длина заготовки, м', 'Закупочный метраж, пог.м'],
    ...[['Рейка', m.slats], ['Гребёнка', m.stringers], ['Уголок', m.wallAngle]].map(([name, v]) => [name, format(v.netLength), format(v.orderLength), v.orderPieces, v.stockLength, format(v.purchasedLength)]),
    [], ['Материал', 'Без запаса, шт.', 'С запасом, шт.'], ['Подвесы', m.hangers.netPieces, m.hangers.orderPieces], ['Крепёж уголка (оценка)', m.wallFixings.netPieces, m.wallFixings.orderPieces],
    [], ['Допущения', 'Прямоугольное помещение; равномерные отступы; обрезки не используются повторно; соединители не учтены; допустимость шага и стыковки согласуется по проекту.'],
    ['Контакты', 'info@prostill.ru · +7 (920) 278-02-01']];
  const quote = v => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const csv = '\uFEFF' + rows.map(row => row.map(quote).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = 'prostill-ceiling-calculation.csv';
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  actionStatus.textContent = 'CSV сохранён. В файле указаны параметры и допущения.';
});
restore(); roomMode(); syncRanges(); update();
