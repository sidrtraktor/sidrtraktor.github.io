const COLORS = { '9006': '#b9bdc1', '9003': '#eeefeb', '9005': '#202126', '7016': '#41464b', '1015': '#d8ccb1', '2004': '#e8561c', wood: '#b47c49' };

export function renderPlan(target, r) {
  const { geometry: g, layout: l, input: i } = r;
  const scale = Math.min(540 / g.width, 270 / g.length);
  const w = g.width * scale, h = g.length * scale, x = (700 - w) / 2, y = (400 - h) / 2;
  const along = i.orientation === 'length', rows = Math.min(l.slatRows, 200), step = (along ? w : h) / rows;
  const railSize = (i.slatWidth / l.pitchMm) * step;
  const railLines = Array.from({ length: rows }, (_, n) => along
    ? `<rect x="${x + (n + 0.5) * step - railSize / 2}" y="${y}" width="${railSize}" height="${h}" fill="${COLORS[i.color] || COLORS['9006']}"/>`
    : `<rect x="${x}" y="${y + (n + 0.5) * step - railSize / 2}" width="${w}" height="${railSize}" fill="${COLORS[i.color] || COLORS['9006']}"/>`).join('');
  const count = Math.min(l.stringerRows, 80), carrierStep = (along ? h : w) / count;
  const carriers = Array.from({ length: count }, (_, n) => along
    ? `<line x1="${x}" x2="${x + w}" y1="${y + (n + 0.5) * carrierStep}" y2="${y + (n + 0.5) * carrierStep}"/>`
    : `<line x1="${x + (n + 0.5) * carrierStep}" x2="${x + (n + 0.5) * carrierStep}" y1="${y}" y2="${y + h}"/>`).join('');
  const caption = g.estimated ? 'Условный квадрат для примера. Расход рассчитан по площади.' : 'Пунктир — гребёнки. Упрощённая схема, не монтажный чертёж.';
  target.innerHTML = `<svg viewBox="0 0 700 430" role="img" aria-label="${g.estimated ? 'Условный пример раскладки по площади' : `Схематичная раскладка потолка, ${i.length} на ${i.width} миллиметров`}"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#e7e9ed"/>${railLines}<g stroke="#e8561c" stroke-width="2" stroke-dasharray="6 4">${carriers}</g><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#17191c" stroke-width="3"/><g fill="#17191c" font-family="Arial,sans-serif" font-size="16" text-anchor="middle">${g.estimated ? '' : `<text x="350" y="${y - 18}">${i.width.toLocaleString('ru-RU')} мм</text><text x="${x - 26}" y="200" transform="rotate(-90 ${x - 26} 200)">${i.length.toLocaleString('ru-RU')} мм</text>`}<text x="350" y="402" font-size="12">${caption}</text></g></svg>`;
}

export function createPreview(canvas, status) {
  if (!window.BABYLON || !window.BABYLON.Engine.isSupported()) { status.textContent = '3D недоступен. Расчёт работает без WebGL.'; return null; }
  const B = window.BABYLON;
  let engine, scene, root, camera, last = null, material, wood;
  try {
    engine = new B.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
    if (window.devicePixelRatio > 1.5) engine.setHardwareScalingLevel(window.devicePixelRatio / 1.5);
    scene = new B.Scene(engine); scene.clearColor = B.Color4.FromHexString('#24282dff');
    const light = new B.HemisphericLight('ambient', new B.Vector3(0, 1, 0), scene); light.intensity = 1.4;
    const side = new B.HemisphericLight('underside', new B.Vector3(-1, -1, 0.5), scene); side.intensity = 0.7;
    camera = new B.ArcRotateCamera('camera', -Math.PI / 2.5, 2.15, 10, B.Vector3.Zero(), scene);
    camera.lowerBetaLimit = 0.4; camera.upperBetaLimit = Math.PI - 0.35;
    camera.wheelDeltaPercentage = 0.04; camera.pinchDeltaPercentage = 0.015; camera.panningSensibility = 1000;
    camera.attachControl(canvas, true);
    material = new B.PBRMetallicRoughnessMaterial('slat-finish', scene); material.metallic = 0.6; material.roughness = 0.3;
    wood = new B.StandardMaterial('wood-finish', scene); wood.diffuseTexture = new B.Texture(new URL('./image/42_3.png', import.meta.url).href, scene); wood.specularColor = new B.Color3(0.12, 0.12, 0.12);
    engine.runRenderLoop(() => { if (!document.hidden && canvas.offsetParent !== null) scene.render(); });
    const observer = new ResizeObserver(() => engine.resize()); observer.observe(canvas);
    window.addEventListener('pagehide', () => { observer.disconnect(); engine.dispose(); }, { once: true });
  } catch { engine?.dispose(); status.textContent = 'Не удалось запустить 3D. Схема и расчёт доступны.'; return null; }
  const supportMat = new B.StandardMaterial('supports', scene); supportMat.diffuseColor = B.Color3.FromHexString('#4b5057');
  function reset() {
    const d = last ? Math.max(Math.min(last.geometry.length, 8), Math.min(last.geometry.width, 8)) : 5;
    camera.setTarget(B.Vector3.Zero()); camera.alpha = -Math.PI / 2.5; camera.beta = 2.15; camera.radius = d * 1.65;
    camera.lowerRadiusLimit = d * 0.35; camera.upperRadiusLimit = d * 4;
  }
  function box(name, width, height, depth, x, y, z, mat) {
    const mesh = B.MeshBuilder.CreateBox(name, { width, height, depth }, scene);
    mesh.position.set(x, y, z); mesh.material = mat; mesh.parent = root; return mesh;
  }
  return {
    reset, resize: () => engine.resize(),
    update(r) {
      const first = !last, changed = last && (last.geometry.length !== r.geometry.length || last.geometry.width !== r.geometry.width);
      last = r; if (root) root.dispose(false, false); root = new B.TransformNode('ceiling-model', scene);
      const { input: i, geometry: g, layout: l } = r;
      const length = Math.min(g.length, 8), width = Math.min(g.width, 8);
      const along = i.orientation === 'length', run = along ? length : width, cross = along ? width : length;
      const pitch = l.pitchMm / 1000, sw = i.slatWidth / 1000, sh = i.slatHeight / 1000;
      const rows = Math.max(1, Math.floor((cross + i.gap / 1000 + 1e-9) / pitch));
      const occupied = rows * sw + (rows - 1) * i.gap / 1000, start = -(occupied - sw) / 2;
      material.baseColor = B.Color3.FromHexString(COLORS[i.color] || COLORS['9006']);
      const finish = i.color === 'wood' ? wood : material;
      for (let n = 0; n < rows; n++) {
        const offset = start + n * pitch;
        box(`slat-${n}`, along ? sw : run, sh, along ? run : sw, along ? offset : 0, 0, along ? 0 : offset, finish);
      }
      const lines = Math.max(2, Math.ceil(run * 1000 / i.stringerSpacing - 1e-9));
      const suspensions = Math.max(2, Math.ceil(cross * 1000 / i.hangerSpacing - 1e-9));
      for (let n = 0; n < lines; n++) {
        const pos = -run / 2 + (n + 0.5) * run / lines;
        box(`stringer-${n}`, along ? width : 0.035, 0.035, along ? 0.035 : length, along ? 0 : pos, sh / 2 + 0.022, along ? pos : 0, supportMat);
        for (let k = 0; k < suspensions; k++) {
          const offset = -cross / 2 + (k + 0.5) * cross / suspensions;
          box(`hanger-${n}-${k}`, 0.006, 0.2, 0.006, along ? offset : pos, sh / 2 + 0.14, along ? pos : offset, supportMat);
        }
      }
      status.textContent = `${i.slatWidth} × ${i.slatHeight} мм · зазор ${i.gap} мм · ${g.length > 8 || g.width > 8 ? 'фрагмент' : 'модель помещения'}`;
      if (first || changed) reset(); engine.resize();
    },
  };
}
