// ═══════════════════════════════════════
//   CHEMSAFE AI — MOL3D.JS (bản OFFLINE)
//   Mô hình cấu tạo 3D hóa chất — đọc THẲNG từ trường chem.sdf3d đã được
//   nhúng sẵn trong chemdata.js. Tọa độ = hình học cân bằng tính bằng DFT
//   (B3LYP-D3(BJ)/def2, PySCF). chem.bonds3d = [i, j, độ dài Å, bậc liên kết
//   Mayer, "cov" | "ion"] tính từ mật độ electron DFT. Không gọi API nào.
// ═══════════════════════════════════════

let currentMol3DViewer = null;
let mol3DSpinning = false;
const MOL3D_SPIN_SPEED = 1; // tốc độ xoay (độ/khung hình), có thể chỉnh 0.5 (chậm) - 2 (nhanh)

// Trạng thái lớp phủ (trục tọa độ, độ dài, góc, nguyên tử đang chọn)
const mol3DOverlay = { axes: true, lengths: false, angles: false, axisScale: 1, picked: null, atoms: [], chem: null };

// Tra bậc liên kết Mayer (DFT) của cặp nguyên tử i–j (chỉ số 0-based)
function mol3DBondInfo(i, j) {
  const list = mol3DOverlay.chem && mol3DOverlay.chem.bonds3d;
  if (!list) return null;
  return list.find(b => (b[0] === i && b[1] === j) || (b[0] === j && b[1] === i)) || null;
}

// Ion kim loại đơn nguyên tử → vẽ nét đứt (liên kết ion) tới nguyên tử gần nhất
const MOL3D_METALS = new Set(["Li","Na","K","Mg","Ca","Ba","Al","Fe","Cu","Zn","Ag","Pb","Hg","Cd","Co","Ni","Mn","Cr"]);
const MOL3D_AXIS_COLORS = { x: "#ff4d5e", y: "#2ed573", z: "#3d8bff" };
// Jmol/CPK là quy ước màu nguyên tử chuẩn được 3Dmol.js hỗ trợ.
const MOL3D_ATOM_COLOR_SCHEME = "Jmol";

const v3 = {
  sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
  add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
  mul: (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k }),
  len: a => Math.hypot(a.x, a.y, a.z),
  dot: (a, b) => a.x * b.x + a.y * b.y + a.z * b.z,
  unit: a => { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; }
};

function mol3DLabel(viewer, text, pos, opts = {}) {
  return viewer.addLabel(text, Object.assign({
    position: pos, fontSize: 11, fontColor: "#e8ecf0", backgroundColor: "#0a0c0f",
    backgroundOpacity: 0.7, borderThickness: 0, inFront: true, alignment: "center",
    font: "Space Mono, monospace"
  }, opts));
}

// Các cặp ion tiếp xúc (kim loại không có liên kết cộng hóa trị ↔ nguyên tử gần)
function mol3DIonContacts(atoms) {
  const out = [];
  const list = mol3DOverlay.chem && mol3DOverlay.chem.bonds3d;
  if (list && atoms === mol3DOverlay.atoms) {
    // Dữ liệu DFT: dùng đúng các cặp ion đã tính sẵn (kèm bậc liên kết Mayer)
    list.filter(b => b[4] === "ion").forEach(b => { if (atoms[b[0]] && atoms[b[1]]) out.push([atoms[b[0]], atoms[b[1]], b[2], b[3]]); });
    return out;
  }
  atoms.forEach((a, i) => {
    if (a.bonds.length || !MOL3D_METALS.has(a.elem)) return;
    const cutoff = ["K","Ba","Pb","Ag","Hg","Cd"].includes(a.elem) ? 3.5 : 3.2;
    atoms.forEach((b, j) => {
      if (i === j || MOL3D_METALS.has(b.elem) || b.elem === "H" || b.elem === "C") return;
      const d = v3.len(v3.sub(a, b));
      if (d <= cutoff) out.push([a, b, d]);
    });
  });
  return out;
}

function drawMol3DOverlays() {
  const viewer = currentMol3DViewer;
  if (!viewer) return;
  viewer.removeAllShapes();
  viewer.removeAllLabels();
  const atoms = mol3DOverlay.atoms;

  // Liên kết ion: luôn hiển thị (nét đứt) để thấy cặp ion
  const ions = mol3DIonContacts(atoms);
  ions.forEach(([a, b, d, bo]) => {
    viewer.addCylinder({ start: { x: a.x, y: a.y, z: a.z }, end: { x: b.x, y: b.y, z: b.z }, radius: 0.04, color: "#c9a227", dashed: true, dashLength: 0.18, gapLength: 0.14, fromCap: 1, toCap: 1 });
    if (mol3DOverlay.lengths) mol3DLabel(viewer, d.toFixed(3) + " Å" + (bo !== undefined ? ` · BO ${bo.toFixed(2)}` : ""), v3.mul(v3.add(a, b), 0.5), { fontColor: "#ffd166" });
  });

  // ── Trục tọa độ X, Y, Z (mũi tên từ gốc O) ──
  if (mol3DOverlay.axes) {
    let ext = 0;
    atoms.forEach(a => { ext = Math.max(ext, Math.abs(a.x), Math.abs(a.y), Math.abs(a.z)); });
    const L = Math.max(ext + 1.0, 1.6) * mol3DOverlay.axisScale;      // chiều dài mũi tên (Å)
    const r = Math.min(Math.max(0.035 * L, 0.04), 0.12);               // bán kính thân mũi tên
    const dirs = { x: { x: 1, y: 0, z: 0 }, y: { x: 0, y: 1, z: 0 }, z: { x: 0, y: 0, z: 1 } };
    Object.entries(dirs).forEach(([k, d]) => {
      const col = MOL3D_AXIS_COLORS[k];
      viewer.addArrow({ start: { x: 0, y: 0, z: 0 }, end: v3.mul(d, L), radius: r, radiusRatio: 2.4, mid: Math.max(0.75, 1 - 0.45 / L), color: col });
      // nửa âm của trục: nét đứt mờ
      viewer.addCylinder({ start: { x: 0, y: 0, z: 0 }, end: v3.mul(d, -L * 0.6), radius: r * 0.45, color: col, dashed: true, dashLength: 0.15, gapLength: 0.15, opacity: 0.6 });
      // vạch chia mỗi 1 Å
      for (let t = 1; t < L - 0.3; t++) viewer.addSphere({ center: v3.mul(d, t), radius: r * 1.5, color: col });
      mol3DLabel(viewer, `${k.toUpperCase()}  ${L.toFixed(1)} Å`, v3.mul(d, L + 0.45), { fontColor: col, fontSize: 12, backgroundOpacity: 0.5 });
    });
    viewer.addSphere({ center: { x: 0, y: 0, z: 0 }, radius: r * 1.8, color: "#ffffff" });
    mol3DLabel(viewer, "O", { x: -0.3, y: -0.3, z: -0.3 }, { fontSize: 10, fontColor: "#ffffff", backgroundOpacity: 0.4 });
  }

  // ── Độ dài liên kết cộng hóa trị ──
  if (mol3DOverlay.lengths) {
    atoms.forEach((a, i) => a.bonds.forEach(j => {
      if (j <= i) return;
      const b = atoms[j];
      const bi = mol3DBondInfo(i, j);
      mol3DLabel(viewer, v3.len(v3.sub(a, b)).toFixed(3) + " Å" + (bi ? ` · BO ${bi[3].toFixed(2)}` : ""), v3.mul(v3.add(a, b), 0.5), { fontSize: 10 });
    }));
  }

  // ── Góc liên kết ──
  if (mol3DOverlay.angles) {
    const big = atoms.length > 20;
    atoms.forEach(c => {
      const nb = c.bonds.map(j => atoms[j]);
      for (let p = 0; p < nb.length; p++) for (let q = p + 1; q < nb.length; q++) {
        if (big && nb[p].elem === "H" && nb[q].elem === "H") continue; // bớt nhãn H–X–H với phân tử lớn
        const u = v3.unit(v3.sub(nb[p], c)), w = v3.unit(v3.sub(nb[q], c));
        const ang = Math.acos(Math.min(1, Math.max(-1, v3.dot(u, w)))) * 180 / Math.PI;
        let bis = v3.add(u, w);
        if (v3.len(bis) < 1e-3) bis = { x: 0, y: 0, z: 0.5 }; // góc 180°
        const pos = v3.add(c, v3.mul(v3.unit(bis), 0.55));
        mol3DLabel(viewer, ang.toFixed(1) + "°", pos, { fontSize: 10, fontColor: "#7fdbff" });
      }
    });
  }

  // ── Nguyên tử đang chọn: hiện tọa độ ──
  const pk = mol3DOverlay.picked;
  if (pk) {
    viewer.addSphere({ center: { x: pk.x, y: pk.y, z: pk.z }, radius: 0.45, color: "#00d4a8", opacity: 0.35 });
    mol3DLabel(viewer, `${pk.elem}${pk.serial} (${pk.x.toFixed(3)}, ${pk.y.toFixed(3)}, ${pk.z.toFixed(3)})`, v3.add(pk, { x: 0, y: 0.6, z: 0 }), { fontColor: "#00d4a8", fontSize: 11 });
  }
  viewer.render();
}

function toggleMol3DOverlay(key, btn) {
  mol3DOverlay[key] = !mol3DOverlay[key];
  if (btn) btn.classList.toggle("active", mol3DOverlay[key]);
  drawMol3DOverlays();
}

function setMol3DAxisScale(val) {
  mol3DOverlay.axisScale = parseFloat(val) || 1;
  const lbl = document.getElementById("mol3d-axis-scale-val");
  if (lbl) lbl.textContent = mol3DOverlay.axisScale.toFixed(1) + "×";
  if (!mol3DOverlay.axes) {
    mol3DOverlay.axes = true;
    const b = document.querySelector('.mol3d-ov-btn[data-ov="axes"]');
    if (b) b.classList.add("active");
  }
  drawMol3DOverlays();
}

function updateMol3DInfo() {
  const info = document.getElementById("mol3d-info");
  if (!info) return;
  const atoms = mol3DOverlay.atoms;
  if (!atoms.length) { info.innerHTML = ""; return; }
  const ext = ["x", "y", "z"].map(k => Math.max(...atoms.map(a => a[k])) - Math.min(...atoms.map(a => a[k])));
  const nBonds = atoms.reduce((s, a) => s + a.bonds.length, 0) / 2;
  const pk = mol3DOverlay.picked;
  info.innerHTML = `
    <span><b>Kích thước</b> X × Y × Z = ${ext.map(e => e.toFixed(2)).join(" × ")} Å</span>
    <span><b>${atoms.length}</b> nguyên tử · <b>${nBonds}</b> liên kết</span>
    ${mol3DOverlay.chem && typeof formatGradeTopics === "function" ? `<span><b>Chương trình</b> ${formatGradeTopics(mol3DOverlay.chem)}</span>` : ""}
    ${mol3DOverlay.chem && mol3DOverlay.chem.sdf3dMethod ? `<span><b>Phương pháp</b> ${mol3DOverlay.chem.sdf3dMethod}</span>` : ""}
    ${pk ? `<span class="mol3d-info-pick"><b>${pk.elem}${pk.serial}</b>: x=${pk.x.toFixed(3)} · y=${pk.y.toFixed(3)} · z=${pk.z.toFixed(3)} Å · r=${v3.len(pk).toFixed(3)} Å</span>` : ""}`;
}

// ── Modal hiển thị mô hình 3D ──
function ensureMol3DModal() {
  if (document.getElementById("mol3d-modal")) return;

  const modal = document.createElement("div");
  modal.id = "mol3d-modal";
  modal.className = "mol3d-modal";
  modal.innerHTML = `
    <div class="mol3d-box">
      <div class="mol3d-head">
        <div>
          <div class="mol3d-title" id="mol3d-title">Mô hình 3D</div>
          <div class="mol3d-sub" id="mol3d-sub"></div>
        </div>
        <button class="mol3d-close" type="button" onclick="closeMol3DModal()">✕</button>
      </div>
      <div class="mol3d-style-row">
        <button class="mol3d-style-btn active" type="button" data-style="stick" onclick="setMol3DStyle('stick', this)">Que</button>
        <button class="mol3d-style-btn" type="button" data-style="sphere" onclick="setMol3DStyle('sphere', this)">Đặc khối</button>
        <button class="mol3d-style-btn" type="button" data-style="line" onclick="setMol3DStyle('line', this)">Nét mảnh</button>
        <button class="mol3d-style-btn mol3d-spin-btn active" type="button" id="mol3d-spin-btn" onclick="toggleMol3DSpin()">🔄 Xoay tự động</button>
      </div>
      <div class="mol3d-style-row mol3d-overlay-row">
        <button class="mol3d-ov-btn active" type="button" data-ov="axes" onclick="toggleMol3DOverlay('axes', this)">↗ Trục XYZ</button>
        <button class="mol3d-ov-btn" type="button" data-ov="lengths" onclick="toggleMol3DOverlay('lengths', this)">📏 Độ dài liên kết</button>
        <button class="mol3d-ov-btn" type="button" data-ov="angles" onclick="toggleMol3DOverlay('angles', this)">∠ Góc liên kết</button>
        <label class="mol3d-axis-size" title="Kích thước mũi tên trục tọa độ">
          Cỡ mũi tên
          <input type="range" id="mol3d-axis-scale" min="0.5" max="2.5" step="0.1" value="1" oninput="setMol3DAxisScale(this.value)" />
          <span id="mol3d-axis-scale-val">1.0×</span>
        </label>
      </div>
      <div class="mol3d-viewport" id="mol3d-viewport"></div>
      <div class="mol3d-info" id="mol3d-info"></div>
      <div class="mol3d-foot" id="mol3d-foot">Mô hình 3D nhúng sẵn offline · Bấm vào một nguyên tử để xem tọa độ.</div>
    </div>`;
  document.body.appendChild(modal);

  modal.addEventListener("click", e => { if (e.target === modal) closeMol3DModal(); });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeMol3DModal();
  });
}

function closeMol3DModal() {
  const modal = document.getElementById("mol3d-modal");
  if (currentMol3DViewer) currentMol3DViewer.spin(false);
  if (modal) modal.classList.remove("visible");
  currentMol3DViewer = null;
  mol3DSpinning = false;
}

// Bật/tắt xoay tự động 360°
function toggleMol3DSpin() {
  if (!currentMol3DViewer) return;
  mol3DSpinning = !mol3DSpinning;
  currentMol3DViewer.spin(mol3DSpinning ? "y" : false, MOL3D_SPIN_SPEED);

  const btn = document.getElementById("mol3d-spin-btn");
  if (btn) {
    btn.classList.toggle("active", mol3DSpinning);
    btn.textContent = mol3DSpinning ? "🔄 Xoay tự động" : "⏸ Đang dừng";
  }
}

function setMol3DStyle(style, btn) {
  document.querySelectorAll(".mol3d-style-btn").forEach(b => b.classList.remove("active"));
  if (btn) btn.classList.add("active");
  if (!currentMol3DViewer) return;

  const styleMap = {
    stick: {
      stick: { radius: 0.15, colorscheme: MOL3D_ATOM_COLOR_SCHEME },
      sphere: { scale: 0.22, colorscheme: MOL3D_ATOM_COLOR_SCHEME }
    },
    sphere: { sphere: { scale: 0.55, colorscheme: MOL3D_ATOM_COLOR_SCHEME } },
    line: { line: { colorscheme: MOL3D_ATOM_COLOR_SCHEME } }
  };
  currentMol3DViewer.setStyle({}, styleMap[style] || styleMap.stick);
  drawMol3DOverlays();
}

// Mở modal và vẽ mô hình 3D CHỈ từ dữ liệu đã có sẵn trong chem.sdf3d.
// Không có fetch(), không có await mạng nào ở đây cả.
function openMol3DModal(chem) {
  if (!chem) return;
  ensureMol3DModal();

  const modal = document.getElementById("mol3d-modal");
  const viewport = document.getElementById("mol3d-viewport");
  modal.classList.add("visible");
  currentMol3DViewer = null;
  document.getElementById("mol3d-title").textContent = `${chem.formula} — ${chem.name}`;
  viewport.innerHTML = "";
  mol3DOverlay.atoms = []; mol3DOverlay.picked = null; mol3DOverlay.chem = chem;
  updateMol3DInfo();

  if (typeof $3Dmol === "undefined") {
    document.getElementById("mol3d-sub").textContent =
      "Thư viện 3Dmol.js chưa tải được. Kiểm tra thẻ <script> 3Dmol trong index.html và kết nối mạng (thư viện này tải từ CDN).";
    return;
  }

  if (!chem.sdf3d) {
    document.getElementById("mol3d-sub").textContent = "Chất này chưa có dữ liệu 3D trong chemdata.js.";
    viewport.innerHTML = `
      <div class="mol3d-empty">
        <strong>${chem.formula}</strong> chưa được nhúng dữ liệu cấu trúc 3D.<br><br>
        Chạy lệnh sau (ở nơi có mạng, một lần duy nhất) để tự động bổ sung:<br>
        <code>node embed-sdf-into-chemdata.js</code><br><br>
        Sau khi chạy xong, mở lại app — không cần chỉnh sửa gì thêm.
      </div>`;
    return;
  }

  currentMol3DViewer = $3Dmol.createViewer(viewport, { backgroundColor: "#0f1420" });
  const model = currentMol3DViewer.addModel(chem.sdf3d, "sdf");
  currentMol3DViewer.setStyle({}, {
    stick: { radius: 0.15, colorscheme: MOL3D_ATOM_COLOR_SCHEME },
    sphere: { scale: 0.22, colorscheme: MOL3D_ATOM_COLOR_SCHEME }
  });
  document.querySelectorAll(".mol3d-style-btn[data-style]").forEach(b => b.classList.toggle("active", b.dataset.style === "stick"));

  mol3DOverlay.atoms = model.selectedAtoms({});
  mol3DOverlay.atoms.forEach((a, i) => { a.serial = i + 1; });
  mol3DOverlay.picked = null;
  currentMol3DViewer.setClickable({}, true, atom => {
    mol3DOverlay.picked = (mol3DOverlay.picked === atom) ? null : atom;
    drawMol3DOverlays();
    updateMol3DInfo();
  });

  drawMol3DOverlays();
  updateMol3DInfo();
  currentMol3DViewer.zoomTo();
  // Nghiêng góc nhìn ban đầu để thấy đủ cả 3 trục X, Y, Z
  currentMol3DViewer.rotate(-25, "y");
  currentMol3DViewer.rotate(20, "x");
  currentMol3DViewer.zoom(1.15);
  currentMol3DViewer.render();

  // Mặc định tự xoay 360° khi vừa mở mô hình; người dùng vẫn kéo chuột được
  // để xoay/zoom thủ công lúc đang xoay (3Dmol tự tạm dừng khi kéo).
  mol3DSpinning = true;
  currentMol3DViewer.spin("y", MOL3D_SPIN_SPEED);
  const spinBtn = document.getElementById("mol3d-spin-btn");
  if (spinBtn) {
    spinBtn.classList.add("active");
    spinBtn.textContent = "🔄 Xoay tự động";
  }

  const isIonic = mol3DIonContacts(mol3DOverlay.atoms).length > 0;
  const foot = document.getElementById("mol3d-foot");
  if (foot) {
    foot.textContent = [
      chem.modelScope,
      chem.sdfFormula ? `Công thức trong SDF: ${chem.sdfFormula}.` : "",
      `Nguồn đối chiếu đề xuất: ${chem.recommendedSource}`,
      `Công nghệ phù hợp: ${chem.recommendedTechnology}`,
      "Gốc O(0,0,0) = tâm khối lượng · X/Y/Z theo trục quán tính chính · đơn vị Å."
    ].filter(Boolean).join(" ");
  }
  document.getElementById("mol3d-sub").textContent = chem.sdf3dIsReal
    ? `${chem.validationTier || "Mô hình tính toán"} · ${chem.sdf3dMethod || "GFN2-xTB"}${chem.bonds3d ? " · BO = bậc liên kết Mayer" : ""}${isIonic ? " · nét đứt vàng = liên kết ion" : ""}`
    : "Đơn chất kim loại/nguyên tố: hiển thị 1 nguyên tử đặt tại gốc tọa độ (không có cấu trúc phân tử).";
}

// Mở mô hình 3D từ tab "Cơ sở dữ liệu" bằng công thức (tra lại trong CHEM_DATABASE)
function openMol3DByFormula(formula) {
  const chem = CHEM_DATABASE.find(c => c.formula === formula);
  if (chem) openMol3DModal(chem);
}

// ═══════════════════════════════════════
//   KIỂM TRA TOÀN BỘ MÔ HÌNH 3D (audit)
//   Chỉ quét chem.sdf3d trong dữ liệu nội bộ, không gọi mạng.
//   Vì vậy chạy gần như tức thì, không cần vòng lặp có delay như bản cũ.
// ═══════════════════════════════════════

function ensureMol3DAuditModal() {
  if (document.getElementById("mol3d-audit-modal")) return;

  const modal = document.createElement("div");
  modal.id = "mol3d-audit-modal";
  modal.className = "mol3d-modal";
  modal.innerHTML = `
    <div class="mol3d-box">
      <div class="mol3d-head">
        <div>
          <div class="mol3d-title">Kiểm tra mô hình 3D toàn bộ CSDL</div>
          <div class="mol3d-sub" id="mol3d-audit-sub">Đang quét dữ liệu nội bộ...</div>
        </div>
        <button class="mol3d-close" type="button" onclick="closeMol3DAuditModal()">✕</button>
      </div>
      <div class="mol3d-audit-body">
        <div class="mol3d-audit-progress-wrap">
          <div class="mol3d-audit-bar"><div class="mol3d-audit-bar-fill" id="mol3d-audit-bar-fill"></div></div>
          <div class="mol3d-audit-count" id="mol3d-audit-count">0 / 0</div>
        </div>
        <div class="mol3d-audit-summary" id="mol3d-audit-summary"></div>
        <div class="mol3d-audit-list" id="mol3d-audit-list"></div>
        <button class="mol3d-db-btn mol3d-audit-copy-btn" type="button" id="mol3d-audit-copy-btn" style="display:none" onclick="copyMol3DAuditFails()">📋 Sao chép báo cáo kiểm định</button>
      </div>
      <div class="mol3d-foot">Quét trực tiếp trong chemdata.js — không cần mạng, không gọi API.</div>
    </div>`;
  document.body.appendChild(modal);

  modal.addEventListener("click", e => { if (e.target === modal) closeMol3DAuditModal(); });
}

function closeMol3DAuditModal() {
  const modal = document.getElementById("mol3d-audit-modal");
  if (modal) modal.classList.remove("visible");
}

function parseFormulaCounts(formula) {
  const text = formula
    .replace(/\s*\(aq\).*$/i, "")
    .replace(/[·.]/g, ".")
    .replace(/[₀₁₂₃₄₅₆₇₈₉]/g, digit => "₀₁₂₃₄₅₆₇₈₉".indexOf(digit));
  const total = {};

  function parsePart(part, start = 0, endChar = "") {
    const counts = {};
    let i = start;
    while (i < part.length && part[i] !== endChar) {
      if (part[i] === "(") {
        const nested = parsePart(part, i + 1, ")");
        i = nested.index;
        const multiplierMatch = part.slice(i).match(/^(\d+)/);
        const multiplier = multiplierMatch ? Number(multiplierMatch[1]) : 1;
        i += multiplierMatch ? multiplierMatch[1].length : 0;
        Object.entries(nested.counts).forEach(([element, count]) => {
          counts[element] = (counts[element] || 0) + count * multiplier;
        });
        continue;
      }
      const elementMatch = part.slice(i).match(/^([A-Z][a-z]?)(\d*)/);
      if (!elementMatch) return { counts, index: part.length };
      const count = elementMatch[2] ? Number(elementMatch[2]) : 1;
      counts[elementMatch[1]] = (counts[elementMatch[1]] || 0) + count;
      i += elementMatch[0].length;
    }
    return { counts, index: i + (endChar && part[i] === endChar ? 1 : 0) };
  }

  text.split(".").forEach(part => {
    const leadingMultiplier = part.match(/^(\d+)/);
    const multiplier = leadingMultiplier ? Number(leadingMultiplier[1]) : 1;
    const parsed = parsePart(part, leadingMultiplier ? leadingMultiplier[1].length : 0);
    Object.entries(parsed.counts).forEach(([element, count]) => {
      total[element] = (total[element] || 0) + count * multiplier;
    });
  });
  return total;
}

function parseSdfAtoms(sdf) {
  const lines = String(sdf || "").split(/\r?\n/);
  const countsLine = lines.findIndex(line => line.includes("V2000"));
  if (countsLine < 0) return { atoms: [], bonds: 0 };
  const counts = lines[countsLine].trim().split(/\s+/);
  const atomCount = Number(counts[0]);
  const bondCount = Number(counts[1]);
  if (!Number.isInteger(atomCount) || atomCount < 1) return { atoms: [], bonds: 0 };
  const atoms = lines.slice(countsLine + 1, countsLine + 1 + atomCount)
    .map(line => line.trim().split(/\s+/)[3])
    .filter(Boolean);
  return { atoms, bonds: Number.isInteger(bondCount) ? bondCount : 0 };
}

function validateMol3DRecord(chem) {
  const issues = [];
  if (!chem.sdf3d) issues.push("Thiếu SDF");
  if (!chem.sdf3dIsReal) issues.push("Chưa có hình học phân tử đáng tin cậy");
  if (!chem.structureType || !chem.validationTier) issues.push("Thiếu hồ sơ phân loại");
  if (!chem.recommendedSource || !chem.recommendedTechnology) issues.push("Thiếu nguồn/công nghệ đối chiếu");

  const sdf = parseSdfAtoms(chem.sdf3d);
  if (!sdf.atoms.length) {
    issues.push("SDF không đọc được danh sách nguyên tử");
  } else {
    const formulaCounts = parseFormulaCounts(chem.sdfFormula || chem.formula);
    const sdfCounts = sdf.atoms.reduce((counts, element) => {
      counts[element] = (counts[element] || 0) + 1;
      return counts;
    }, {});
    const formulaElements = Object.keys(formulaCounts).sort();
    const sdfElements = Object.keys(sdfCounts).sort();
    const formulaMatchesSdf = formulaElements.length === sdfElements.length
      && formulaElements.every((element, index) => element === sdfElements[index] && formulaCounts[element] === sdfCounts[element]);
    if (!formulaMatchesSdf) {
      issues.push("Công thức không khớp số nguyên tử trong SDF");
    }
    if (sdf.bonds < 0) issues.push("Số liên kết SDF không hợp lệ");
  }
  if (chem.sdf3dSource === "rdkit-gfn2xtb-offline" && String(chem.sdf3dMethod || "").includes("DFT")) {
    issues.push("Nguồn xTB nhưng phương pháp ghi DFT");
  }
  return { valid: issues.length === 0, issues };
}

function getMol3DMethodGroup(chem) {
  if (chem.sdf3dSource === "rdkit-gfn2xtb-offline" || /xTB/i.test(chem.sdf3dMethod || "")) {
    return "GFN2-xTB";
  }
  if (/DFT|PySCF/i.test(`${chem.sdf3dSource || ""} ${chem.sdf3dMethod || ""}`)) {
    return "DFT/PySCF";
  }
  return "Khác/chưa xác định";
}

function auditAllMol3D() {
  ensureMol3DAuditModal();

  const modal = document.getElementById("mol3d-audit-modal");
  const sub = document.getElementById("mol3d-audit-sub");
  const barFill = document.getElementById("mol3d-audit-bar-fill");
  const countEl = document.getElementById("mol3d-audit-count");
  const summaryEl = document.getElementById("mol3d-audit-summary");
  const listEl = document.getElementById("mol3d-audit-list");
  const copyBtn = document.getElementById("mol3d-audit-copy-btn");

  modal.classList.add("visible");
  listEl.innerHTML = "";
  summaryEl.innerHTML = "";
  copyBtn.style.display = "none";

  const total = CHEM_DATABASE.length;
  let okCount = 0, partialCount = 0, failCount = 0, warningCount = 0;
  window.mol3dAuditFails = [];
  window.mol3dAuditPartials = [];
  window.mol3dAuditWarnings = [];
  const groupedRows = {
    "DFT/PySCF": document.createElement("section"),
    "GFN2-xTB": document.createElement("section"),
    "Khác/chưa xác định": document.createElement("section")
  };
  Object.entries(groupedRows).forEach(([group, section]) => {
    section.className = "mol3d-audit-group";
    section.innerHTML = `<h3 class="mol3d-audit-group-title">${group}</h3>`;
    listEl.appendChild(section);
  });

  CHEM_DATABASE.forEach((chem, idx) => {
    const row = document.createElement("div");
    const methodGroup = getMol3DMethodGroup(chem);

    const validation = validateMol3DRecord(chem);
    if (chem.sdf3d && chem.sdf3dIsReal && validation.valid) {
      okCount++;
      row.className = "mol3d-audit-row";
      row.innerHTML = `
        <div><span class="mol3d-audit-row-name">✅ ${chem.name}</span><span class="mol3d-audit-row-formula">${chem.formula}</span></div>
        <span class="mol3d-audit-row-formula">${chem.validationTier}</span>`;
    } else if (chem.sdf3d && chem.sdf3dIsReal && !validation.valid) {
      warningCount++;
      window.mol3dAuditWarnings.push({ chem, issues: validation.issues });
      row.className = "mol3d-audit-row partial";
      row.innerHTML = `
        <div><span class="mol3d-audit-row-name">🟡 ${chem.name}</span><span class="mol3d-audit-row-formula">${chem.formula}</span></div>
        <span class="mol3d-audit-row-formula">${validation.issues.join("; ")}</span>`;
    } else if (chem.sdf3d && !chem.sdf3dIsReal) {
      partialCount++;
      window.mol3dAuditPartials.push(chem);
      row.className = "mol3d-audit-row partial";
      row.innerHTML = `
        <div><span class="mol3d-audit-row-name">🟡 ${chem.name}</span><span class="mol3d-audit-row-formula">${chem.formula}</span></div>
        <span class="mol3d-audit-row-formula">Nguyên tử đơn lẻ</span>`;
    } else {
      failCount++;
      window.mol3dAuditFails.push(chem);
      row.className = "mol3d-audit-row fail";
      row.innerHTML = `
        <div><span class="mol3d-audit-row-name">⚠️ ${chem.name}</span><span class="mol3d-audit-row-formula">${chem.formula}</span></div>
        <span class="mol3d-audit-row-formula">Chưa nhúng dữ liệu</span>`;
    }
    groupedRows[methodGroup].appendChild(row);

    const pct = Math.round(((idx + 1) / total) * 100);
    barFill.style.width = pct + "%";
    countEl.textContent = `${idx + 1} / ${total}`;
  });

  const dftCount = CHEM_DATABASE.filter(chem => getMol3DMethodGroup(chem) === "DFT/PySCF").length;
  const xtbCount = CHEM_DATABASE.filter(chem => getMol3DMethodGroup(chem) === "GFN2-xTB").length;
  const otherCount = total - dftCount - xtbCount;
  summaryEl.innerHTML = `<span class="ok">✅ Hợp lệ nội bộ: ${okCount}</span><span class="partial">🟡 Cần xem lại: ${warningCount + partialCount}</span><span class="fail">⚠️ Chưa có: ${failCount}</span><span>DFT/PySCF: ${dftCount}</span><span>GFN2-xTB: ${xtbCount}</span><span>Khác: ${otherCount}</span>`;
  sub.textContent = `Đã kiểm tra SDF, công thức, phân loại và nguồn: ${okCount} hợp lệ nội bộ, ${warningCount} cảnh báo, ${partialCount} mô hình đơn giản, ${failCount} thiếu dữ liệu.`;
  if (failCount > 0 || partialCount > 0 || warningCount > 0) copyBtn.style.display = "inline-flex";
}

function copyMol3DAuditFails() {
  const fails = (window.mol3dAuditFails || []).map(c => `${c.formula}\t${c.name}\tCHƯA CÓ`);
  const partials = (window.mol3dAuditPartials || []).map(c => `${c.formula}\t${c.name}\tCHỈ CÓ 2D`);
  const warnings = (window.mol3dAuditWarnings || []).map(({ chem, issues }) =>
    `${chem.formula}\t${chem.name}\tCẦN XEM LẠI\t${issues.join("; ")}`
  );
  const all = [...fails, ...partials, ...warnings];
  if (!all.length) return;
  const text = all.join("\n");
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById("mol3d-audit-copy-btn");
    if (btn) {
      const original = btn.textContent;
      btn.textContent = "✔️ Đã sao chép!";
      setTimeout(() => { btn.textContent = original; }, 1800);
    }
  }).catch(() => {
    alert(text);
  });
}

// Gắn nút "Xem mô hình 3D" vào một bong bóng chat đã render
function attachMol3DButton(chem, bubbleEl) {
  if (!chem || !bubbleEl) return;
  if (bubbleEl.querySelector(".mol3d-trigger")) return;

  const btn = document.createElement("button");
  btn.className = "mol3d-trigger";
  btn.type = "button";
  btn.textContent = "🧬 Xem mô hình 3D";
  btn.onclick = () => openMol3DModal(chem);
  bubbleEl.appendChild(btn);
}
