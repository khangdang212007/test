// ═══════════════════════════════════════════════════════════════════
//   CHEMSAFE AI — APP.JS (BẢN GỘP HOÀN CHỈNH)
//   - Tra cứu Offline từ chemdata.js (phân lớp 6-12 & Nâng cao)
//   - Tích hợp PubChem PUG REST API khi tra cứu chất mở rộng
//   - Hỗ trợ kết nối AI Server (Ollama gemma3:4b) linh hoạt
//   - Nhận diện giọng nói (Speech-to-Text) & Đọc câu trả lời (Text-to-Speech)
//   - Đính kèm file / hình ảnh bài tập trong Chat
//   - Mô phỏng thí nghiệm tương tác (Iframe/Modal) & Video phản ứng
//   - Tích hợp mô hình phân tử 3D (Mol3D / 3Dmol.js)
//   - Máy tính hóa học (Mol, Nồng độ, Pha chế, Pha loãng) & Lời giải từng bước
//   - Tạo và tải mã QR nhãn dán hóa chất chuẩn an toàn
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════
// 1. CẤU HÌNH VÀ BIẾN TOÀN CỤC
// ═══════════════════════════════════════

const PUBCHEM_PUG_BASE = "https://pubchem.ncbi.nlm.nih.gov/rest/pug";
const PUBCHEM_PROPERTIES = "Title,IUPACName,MolecularFormula,MolecularWeight";

// Lịch sử hội thoại
let conversationHistory = [];

// Biến lưu hóa chất & phản ứng vừa khớp gần nhất (cho các nút 3D/video/thí nghiệm)
window.lastMatchedChem = null;
window.lastMatchedMix = null;

// Thí nghiệm mô phỏng tương tác
const EXPERIMENT_DATABASE = {
  "fe|cuso4": {
    title: "Thí nghiệm: Đinh sắt + dung dịch CuSO₄",
    src: "experiments/fe-cuso4.html"
  }
};

// Quản lý file đính kèm trong chat
let currentAIFile = null;

// Quản lý giọng nói (Voice Input & TTS)
let speechRecognition = null;
let isListening = false;
let autoSpeakAI = true;

// Quản lý QR Code
let qrInstance = null;

// Lớp học đang chọn (toàn app): "all" = tất cả; 6..12 = phân lớp
const GRADE_NUMBERS = [6, 7, 8, 9, 10, 11, 12];
let currentGrade = "all";
try {
  const saved = localStorage.getItem("chemsafe-grade");
  if (saved && GRADE_NUMBERS.includes(Number(saved))) currentGrade = Number(saved);
} catch (e) { /* Trình duyệt chặn localStorage -> dùng mặc định */ }

function getStartupNotice() {
  return `👋 **ChemSafe AI sẵn sàng hỗ trợ bạn!**\n\nHệ thống hỗ trợ tra cứu hóa chất theo chương trình học (Lớp 6–12), cảnh báo nguy hiểm khi trộn, tính toán hóa học và mô phỏng thí nghiệm trực quan.`;
}

// ═══════════════════════════════════════
// 2. QUẢN LÝ PHÂN LỚP HỌC (GRADES)
// ═══════════════════════════════════════

function parseGrade(value) {
  const n = Number(value);
  return GRADE_NUMBERS.includes(n) ? n : "all";
}

function isChemInGrade(chem, grade = currentGrade) {
  if (grade === "all") return true;
  return (chem.grades || []).some(g => g <= grade);
}

function getGradeLabel(grade = currentGrade) {
  return grade === "all" ? "Tất cả các lớp" : `Lớp ${grade}`;
}

function getGradeSubject(grade) {
  const lv = (typeof GRADE_LEVELS !== "undefined" ? GRADE_LEVELS : []).find(l => l.id === grade);
  return lv ? lv.subject : "";
}

function formatGradeTopics(chem) {
  if (!chem || chem.isAdvanced || !(chem.gradeTopics || []).length) {
    return "Nâng cao: ngoài chương trình phổ thông, chủ yếu gặp trong phòng thí nghiệm.";
  }
  const byGrade = {};
  chem.gradeTopics.forEach(([g, topic]) => {
    (byGrade[g] = byGrade[g] || []).push(topic);
  });
  return Object.keys(byGrade)
    .map(Number)
    .sort((a, b) => a - b)
    .map(g => `Lớp ${g} (${getGradeSubject(g)}): ${byGrade[g].join("; ")}`)
    .join(" · ");
}

function getGradeBadgesHtml(chem) {
  if (chem.isAdvanced) return `<span class="grade-badge nc">Nâng cao</span>`;
  return (chem.grades || []).map(g => `<span class="grade-badge g${g}">L${g}</span>`).join("");
}

function buildGradeListResponse(grade) {
  const seenF = new Set();
  const list = getUniqueChemicalCatalog(true)
    .filter(c => (c.grades || []).includes(grade))
    .filter(c => !seenF.has(c.formula) && seenF.add(c.formula));
  if (!list.length) return `Chưa có chất nào gắn với **Lớp ${grade}** trong dữ liệu.`;
  const byTopic = {};
  list.forEach(c =>
    c.gradeTopics
      .filter(t => t[0] === grade)
      .forEach(([, topic]) => {
        (byTopic[topic] = byTopic[topic] || []).push(c.formula);
      })
  );
  const rows = Object.entries(byTopic).map(
    ([topic, f]) => `- **${topic}:** ${[...new Set(f)].join(", ")}`
  );
  return `📚 **Lớp ${grade} · ${getGradeSubject(grade)}** (${list.length} chất)\n\n${rows.join("\n")}\n\nBấm một chất ở tab **Cơ sở dữ liệu** hoặc hỏi tên chất để xem chi tiết.`;
}

// Câu hỏi nhanh thay đổi theo lớp
const GRADE_QUICK = {
  all: [
    ["HCl là gì?", "HCl là gì? Cho tôi biết tính chất và mức độ nguy hiểm"],
    ["NaOH + HCl?", "Trộn NaOH và HCl có nguy hiểm không? Giải thích phản ứng"],
    ["Sơ cứu axit", "Axit đổ ra da phải làm gì? Hướng dẫn sơ cứu khẩn cấp"],
    ["Lưu trữ H₂SO₄", "H2SO4 đặc bảo quản và lưu trữ thế nào cho an toàn?"],
    ["Hóa chất cấm trộn", "Các hóa chất tuyệt đối không được trộn với nhau là gì?"],
    ["MSDS là gì?", "MSDS là gì và cách đọc tài liệu an toàn hóa chất?"]
  ],
  6: [
    ["Chất lớp 6", "Lớp 6 học những chất nào?"],
    ["O₂ là gì?", "O2 là gì?"],
    ["CO₂ là gì?", "CO2 là gì?"],
    ["Muối ăn NaCl", "NaCl là gì?"],
    ["Đường sucrose", "Sucrose là gì?"],
    ["Cồn C₂H₅OH", "Ethanol là gì?"]
  ],
  7: [
    ["Chất lớp 7", "Lớp 7 học những chất nào?"],
    ["NaCl liên kết gì?", "NaCl là gì?"],
    ["NH₃ là gì?", "NH3 là gì?"],
    ["Khí Cl₂", "Cl2 là gì?"],
    ["Glucose (quang hợp)", "Glucose là gì?"],
    ["Lưu huỳnh S", "Lưu huỳnh là gì?"]
  ],
  8: [
    ["Chất lớp 8", "Lớp 8 học những chất nào?"],
    ["HCl là gì?", "HCl là gì? Cho tôi biết tính chất và mức độ nguy hiểm"],
    ["NaOH + HCl?", "Trộn NaOH và HCl có nguy hiểm không? Giải thích phản ứng"],
    ["Lưu trữ H₂SO₄", "H2SO4 đặc bảo quản và lưu trữ thế nào cho an toàn?"],
    ["Phân urea", "Urea là gì?"],
    ["Sơ cứu axit", "Axit đổ ra da phải làm gì? Hướng dẫn sơ cứu khẩn cấp"]
  ],
  9: [
    ["Chất lớp 9", "Lớp 9 học những chất nào?"],
    ["Ethanol", "C2H5OH là gì?"],
    ["Acetic acid", "CH3COOH là gì?"],
    ["Đá vôi CaCO₃", "CaCO3 là gì?"]
  ],
  10: [
    ["Chất lớp 10", "Lớp 10 học những chất nào?"],
    ["Khí Cl₂", "Cl2 là gì?"],
    ["KMnO₄", "KMnO4 là gì?"],
    ["Nước Javel", "NaClO là gì?"],
    ["HF nguy hiểm?", "HF là gì?"],
    ["NaClO + HCl?", "Trộn NaClO và HCl có nguy hiểm không?"]
  ],
  11: [
    ["Chất lớp 11", "Lớp 11 học những chất nào?"],
    ["NH₃", "NH3 là gì?"],
    ["HNO₃ đặc", "HNO3 là gì?"],
    ["Benzene", "Benzene là gì?"],
    ["Phenol", "Phenol là gì?"],
    ["Lưu trữ H₂SO₄", "H2SO4 đặc bảo quản và lưu trữ thế nào cho an toàn?"]
  ],
  12: [
    ["Chất lớp 12", "Lớp 12 học những chất nào?"],
    ["Glucose", "Glucose là gì?"],
    ["Aniline", "Aniline là gì?"],
    ["Ethyl acetate", "Ethyl Acetate là gì?"],
    ["K₂Cr₂O₇", "K2Cr2O7 là gì?"],
    ["Nước vôi Ca(OH)₂", "Ca(OH)2 là gì?"]
  ]
};

function renderQuickChips() {
  const row = document.getElementById("quick-chips");
  if (!row) return;
  const items = GRADE_QUICK[currentGrade] || GRADE_QUICK.all;
  row.innerHTML = items
    .map(
      ([label, q]) =>
        `<button type="button" class="chip" onclick="sendQuick('${q.replace(/'/g, "\\'")}')">${escapeHtml(label)}</button>`
    )
    .join("");
}

function updateGradeUI() {
  const sel = document.getElementById("grade-select");
  if (sel) sel.value = String(currentGrade);
  const count = getUniqueChemicalCatalog().length;
  const total = getUniqueChemicalCatalog(true).length;
  const countEl = document.getElementById("grade-count");
  if (countEl) {
    countEl.textContent =
      currentGrade === "all"
        ? `Nhận diện ${total} chất`
        : `Nhận diện ${count}/${total} chất (lớp 6–${currentGrade})`;
  }
  const sub = document.getElementById("chat-sub");
  if (sub) {
    sub.textContent =
      currentGrade === "all"
        ? "Hỏi bất cứ điều gì về hóa chất — đang nhận diện tất cả các lớp"
        : `Đang nhận diện chất trong chương trình từ lớp 6 đến lớp ${currentGrade} (${getGradeSubject(currentGrade)})`;
  }
}

function setGrade(value, silent = false) {
  currentGrade = parseGrade(value);
  try {
    localStorage.setItem("chemsafe-grade", String(currentGrade));
  } catch (e) {}
  dbGradeView = "group";
  renderMixOptions();
  renderDBGradeChips();
  filterDB(document.querySelector(".db-search")?.value || "");
  renderQuickChips();
  updateGradeUI();
  const calcSearch = document.getElementById("calc-chemical-search");
  if (calcSearch && document.getElementById("calc-chemical-results")?.classList.contains("show")) {
    renderCalcChemicalResults(calcSearch.value);
  }
  if (!silent) {
    appendMessage(
      "bot",
      currentGrade === "all"
        ? "📚 Đã chuyển sang **Tất cả các lớp**: nhận diện mọi chất, gồm cả nhóm Nâng cao."
        : `📚 Đã chuyển sang **Lớp ${currentGrade}** (${getGradeSubject(currentGrade)}): chỉ nhận diện ${getUniqueChemicalCatalog().length} chất học từ lớp 6 đến lớp ${currentGrade}.`
    );
  }
}

// ═══════════════════════════════════════
// 3. TIỆN ÍCH XỬ LÝ VĂN BẢN & CÔNG THỨC
// ═══════════════════════════════════════

const SUBSCRIPT_DIGITS = {
  "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4",
  "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9"
};

const ELEMENT_SYMBOLS = new Set([
  "H", "He", "Li", "Be", "B", "C", "N", "O", "F", "Ne",
  "Na", "Mg", "Al", "Si", "P", "S", "Cl", "Ar", "K", "Ca",
  "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn",
  "Ga", "Ge", "As", "Se", "Br", "Kr", "Rb", "Sr", "Y", "Zr",
  "Nb", "Mo", "Tc", "Ru", "Rh", "Pd", "Ag", "Cd", "In", "Sn",
  "Sb", "Te", "I", "Xe", "Cs", "Ba", "La", "Ce", "Pr", "Nd",
  "Pm", "Sm", "Eu", "Gd", "Tb", "Dy", "Ho", "Er", "Tm", "Yb",
  "Lu", "Hf", "Ta", "W", "Re", "Os", "Ir", "Pt", "Au", "Hg",
  "Tl", "Pb", "Bi", "Po", "At", "Rn", "Fr", "Ra", "Ac", "Th",
  "Pa", "U", "Np", "Pu", "Am", "Cm", "Bk", "Cf", "Es", "Fm",
  "Md", "No", "Lr", "Rf", "Db", "Sg", "Bh", "Hs", "Mt", "Ds",
  "Rg", "Cn", "Nh", "Fl", "Mc", "Lv", "Ts", "Og"
]);

function normalizeText(value) {
  return String(value || "")
    .replace(/[₀₁₂₃₄₅₆₇₈₉]/g, ch => SUBSCRIPT_DIGITS[ch] || ch)
    .toLowerCase()
    .normalize("NFD")
    .replace(/đ/g, "d")
    .replace(/[\u0300-\u036f]/g, "");
}

function compactFormula(value) {
  return normalizeText(value).replace(/[^a-z0-9]/g, "");
}

function getCompactTokens(value) {
  const plain = String(value || "").replace(/[₀₁₂₃₄₅₆₇₈₉]/g, ch => SUBSCRIPT_DIGITS[ch] || ch);
  return (plain.match(/[A-Za-z0-9]+/g) || []).map(compactFormula).filter(Boolean);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsTextAlias(aliasText, normalizedText) {
  const escaped = escapeRegExp(aliasText).replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "u").test(normalizedText);
}

function matchesChemicalAlias(alias, normalizedText, compactTokens) {
  const aliasText = normalizeText(alias);
  const aliasCompact = compactFormula(alias);
  if (!aliasText || !aliasCompact) return false;

  if (isValidFormula(alias)) {
    if (aliasCompact.length < 2) return false;
    return containsTextAlias(aliasText, normalizedText) || compactTokens.includes(aliasCompact);
  }

  return aliasText.length >= 3 && containsTextAlias(aliasText, normalizedText);
}

function getChemicalNameAliases(name) {
  const raw = String(name || "").trim();
  if (!raw) return [];

  const aliases = new Set([raw]);
  const primary = raw.split(/[(/]/)[0].trim();
  if (primary) aliases.add(primary);

  for (const match of raw.matchAll(/\(([^)]+)\)/g)) {
    const part = match[1].trim();
    if (!part) continue;
    aliases.add(part);
    part
      .split(/[;,/]/)
      .map(item => item.trim())
      .filter(Boolean)
      .forEach(item => aliases.add(item));
  }

  return [...aliases].filter(alias => normalizeText(alias).length >= 3);
}

function isValidFormula(value) {
  const formula = String(value || "").replace(/[₀₁₂₃₄₅₆₇₈₉]/g, ch => SUBSCRIPT_DIGITS[ch] || ch);
  if (!formula || /[^A-Za-z0-9]/.test(formula)) return false;

  let position = 0;
  const matcher = /([A-Z][a-z]?)(\d*)/g;
  let match;
  while ((match = matcher.exec(formula)) !== null) {
    if (match.index !== position || !ELEMENT_SYMBOLS.has(match[1])) return false;
    position = matcher.lastIndex;
  }

  return position === formula.length;
}

function looksLikeFormula(value) {
  return isValidFormula(value);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatMessageText(text) {
  return String(text || "")
    .split(/(`[^`\n]+`)/g)
    .map(part => {
      if (/^`[^`\n]+`$/.test(part)) {
        return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
      }
      return escapeHtml(part).replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    })
    .join("")
    .replace(/\n/g, "<br>");
}

// Kiểm tra đơn chất
function isElementalSubstance(chem) {
  if (!chem) return false;
  const formula = String(chem.formula || "")
    .replace(/[₀₁₂₃₄₅₆₇₈₉]/g, ch => SUBSCRIPT_DIGITS[ch] || ch)
    .replace(/\s+/g, "");
  return /^[A-Z][a-z]?\d*$/.test(formula);
}

// ═══════════════════════════════════════
// 4. QUẢN LÝ CSDL HÓA CHẤT NỘI BỘ
// ═══════════════════════════════════════

function getChemicalCatalog(includeAll = false) {
  const keysByFormula = {
    hcl: "hcl", h2so4: "h2so4", hno3: "hno3", naoh: "naoh", koh: "koh",
    nh3: "nh3", h2o2: "h2o2", cl2: "cl2", c2h5oh: "ethanol",
    ch3coch3: "acetone", ch3oh: "methanol", nacl: "nacl", hf: "hf", kmno4: "kmno4",
    fe: "fe", cuso4: "cuso4"
  };

  if (typeof CHEM_DATABASE === "undefined") return [];

  return CHEM_DATABASE.filter(chem => includeAll || isChemInGrade(chem)).map(chem => ({
    ...chem,
    key: keysByFormula[compactFormula(chem.formula)] || compactFormula(chem.formula),
    aliases: [chem.formula, ...getChemicalNameAliases(chem.name), ...(chem.aliases || [])]
  }));
}

function getUniqueChemicalCatalog(includeAll = false) {
  const unique = new Map();
  getChemicalCatalog(includeAll).forEach(chem => {
    if (!unique.has(chem.key)) unique.set(chem.key, chem);
  });
  return [...unique.values()];
}

function getChemByKey(key) {
  return getUniqueChemicalCatalog(true).find(chem => chem.key === key);
}

function getChemLabel(key) {
  const chem = getChemByKey(key);
  return chem ? `${chem.formula} (${chem.name})` : key;
}

function getChemShortLabel(key) {
  return getChemByKey(key)?.formula || key;
}

function findMentionedChemicals(text, includeAll = false) {
  const normalized = normalizeText(text);
  const compactTokens = getCompactTokens(text);
  const seen = new Set();

  return getChemicalCatalog(includeAll).filter(chem => {
    const formula = compactFormula(chem.formula);
    const name = normalizeText(chem.name);
    const aliases = chem.aliases || [];

    const matched =
      (formula.length >= 2 && compactTokens.includes(formula)) ||
      (name.length >= 3 && normalized.includes(name)) ||
      aliases.some(alias => matchesChemicalAlias(alias, normalized, compactTokens));

    if (!matched || seen.has(chem.key)) return false;
    seen.add(chem.key);
    return true;
  });
}

function formatDanger(chem) {
  return (
    chem.dangerLabel ||
    ({ danger: "NGUY HIỂM", caution: "THẬN TRỌNG", safe: "AN TOÀN" }[chem.danger] || "CHƯA RÕ")
  );
}

function getPpeForChem(chem) {
  if (chem.ppe) return chem.ppe;
  const text = normalizeText(`${chem.name} ${chem.properties} ${chem.msds}`);

  if (text.includes("khi") || text.includes("amoniac") || text.includes("clo") || text.includes("hoi")) {
    return "Kính kín chống hóa chất, găng phù hợp, áo choàng/tạp dề; thao tác trong tủ hút hoặc khu vực thông gió mạnh.";
  }
  if (text.includes("axit")) {
    return "Kính chống bắn, găng chống axit, áo blouse/tạp dề chống hóa chất; dùng tủ hút nếu có hơi axit.";
  }
  if (text.includes("kiem") || text.includes("hydroxide")) {
    return "Kính chống bắn, găng nitrile/neoprene, áo blouse; tránh tiếp xúc da và mắt.";
  }
  if (text.includes("dung moi") || text.includes("de chay")) {
    return "Kính bảo hộ, găng nitrile, áo blouse; tránh nguồn lửa và làm việc nơi thông gió.";
  }
  return "Kính bảo hộ, găng tay phù hợp hóa chất và áo blouse phòng thí nghiệm.";
}

function getFirstAidForChem(chem) {
  if (chem.firstAid) return chem.firstAid;
  const text = normalizeText(`${chem.name} ${chem.properties} ${chem.msds}`);

  if (text.includes("hf") || text.includes("flohidric")) {
    return "Rửa nước ngay ít nhất 15 phút, dùng gel calcium gluconate nếu có theo SOP và gọi cấp cứu/chống độc ngay.";
  }
  if (text.includes("axit") || text.includes("kiem") || text.includes("an mon") || text.includes("hydroxide")) {
    return "Dính da/mắt: rửa nước liên tục 15-20 phút, tháo đồ nhiễm bẩn. Hít phải: ra nơi thoáng khí. Nuốt phải: không gây nôn, gọi y tế.";
  }
  if (text.includes("dung moi") || text.includes("de chay")) {
    return "Hít phải: ra nơi thoáng khí. Dính da: rửa bằng nước/xà phòng. Vào mắt: rửa 15 phút. Nuốt phải hoặc chóng mặt nặng: gọi y tế.";
  }
  return "Dính da/mắt: rửa nước 15 phút. Hít phải: ra nơi thoáng khí. Nuốt phải hoặc triệu chứng nặng: gọi cơ sở y tế.";
}

function getPhysicalProperties(chem) {
  if (chem.physicalProperties) return chem.physicalProperties;
  if (chem.physical) return chem.physical;

  const details = [
    chem.state,
    chem.appearance,
    chem.colorName,
    chem.boiling && `Nhiệt độ sôi: ${chem.boiling}`,
    chem.melting && `Nhiệt độ nóng chảy: ${chem.melting}`,
    chem.solubility && `Độ tan: ${chem.solubility}`,
    chem.ph && `pH tham khảo: ${chem.ph}`
  ].filter(Boolean);

  return details.join("; ") || "Chưa cập nhật dữ liệu tính chất vật lý.";
}

function getChemicalProperties(chem) {
  return chem.chemicalProperties || chem.chemical || chem.properties || "Chưa cập nhật dữ liệu tính chất hóa học.";
}

function buildChemicalInfoResponse(chem) {
  return `🔬 **${chem.name}**\n\n**Công thức:** ${chem.formula}\n\n**Khối lượng mol:** ${chem.molar || formatCalcNumber(chem.molarMass, "g/mol")}\n\n**Tính chất vật lý:** ${getPhysicalProperties(chem)}\n\n**Tính chất hóa học:** ${getChemicalProperties(chem)}\n\n**Cảnh báo nguy hiểm:** ${formatDanger(chem)} - ${chem.msds || getChemicalProperties(chem)}\n\n**PPE:** ${getPpeForChem(chem)}\n\n**Bảo quản:** ${chem.storage || "Bảo quản kín, có nhãn rõ, tách khỏi nhóm hóa chất tương kỵ."}\n\n**Sơ cứu:** ${getFirstAidForChem(chem)}\n\n**📚 Chương trình học:** ${formatGradeTopics(chem)}`;
}

function buildMixResponse(first, second) {
  const key = getMixKey(first.key, second.key);
  window.lastMatchedMix = { first, second, key };
  if (!key) {
    return `⚗️ **${first.formula} + ${second.formula}**\n\nChưa có cảnh báo đặc biệt trong dữ liệu nội bộ cho tổ hợp này.\n\nVẫn cần xử lý như tình huống có rủi ro: dùng lượng nhỏ, kiểm soát nhiệt, làm trong khu vực thông gió/tủ hút, chuẩn bị PPE và không trộn nếu chưa có quy trình được phê duyệt.`;
  }

  const warning = MIX_WARNINGS[key];
  return `${warning.title}\n\n**Tổ hợp:** ${first.formula} + ${second.formula}\n\n**Phản ứng:** ${warning.reaction}\n\n**Mô tả:** ${warning.desc}\n\n**Rủi ro:** ${warning.tags.join(", ")}\n\n**Khuyến nghị:** không tự ý trộn; nếu bắt buộc trong phòng thí nghiệm, chỉ thực hiện theo SOP, trong tủ hút, có giám sát và PPE đầy đủ.`;
}

function buildCommonWarningsResponse() {
  const catalog = getChemicalCatalog(true);
  const byKey = Object.fromEntries(catalog.map(chem => [chem.key, chem]));
  const rows = Object.entries(MIX_WARNINGS).slice(0, 8).map(([key, warning]) => {
    const pair = key.split("|").map(part => byKey[part]?.formula || part).join(" + ");
    return `- **${pair}:** ${warning.title} - ${warning.tags.join(", ")}`;
  });

  return `⚠️ **Một số cặp hóa chất không nên trộn**\n\n${rows.join("\n")}\n\nDanh sách này không thay thế MSDS/SDS hoặc SOP của phòng thí nghiệm. Khi không chắc, hãy coi là nguy hiểm và hỏi người phụ trách an toàn.`;
}

function buildFirstAidResponse() {
  return `🚨 **Sơ cứu khi tiếp xúc hóa chất**\n\n1. Ngừng tiếp xúc ngay, đưa người bị nạn ra khu vực an toàn nếu không gây nguy hiểm thêm.\n2. Dính da: xả dưới vòi nước sạch ít nhất 15-20 phút, tháo bỏ quần áo/găng bị nhiễm.\n3. Vào mắt: rửa mắt liên tục 15-20 phút, giữ mí mắt mở, không dụi mắt.\n4. Hít phải: đưa ra nơi thoáng khí, nới lỏng quần áo, theo dõi khó thở.\n5. Nuốt phải: không tự gây nôn; kiểm tra SDS và gọi cấp cứu/trung tâm chống độc.\n\nNếu bỏng nặng, khó thở, đau mắt, hoặc hóa chất là HF/oxy hóa mạnh/ăn mòn mạnh: gọi 115 hoặc cơ sở y tế ngay.`;
}

function buildMsdsResponse(chem) {
  if (chem) {
    return `📋 **MSDS/SDS tóm tắt cho ${chem.formula} - ${chem.name}**\n\n**Nguy cơ:** ${formatDanger(chem)}\n\n**Thông tin an toàn:** ${chem.msds}\n\n**PPE:** ${getPpeForChem(chem)}\n\n**Bảo quản:** ${chem.storage}\n\n**Sơ cứu:** ${getFirstAidForChem(chem)}\n\nKhi dùng thực tế, hãy đối chiếu SDS chính thức của nhà cung cấp vì nồng độ và dạng tồn tại có thể làm thay đổi mức nguy hiểm.`;
  }
  return `📋 **MSDS/SDS là gì?**\n\nSDS là tài liệu an toàn hóa chất, thường có 16 mục: nhận dạng hóa chất, nguy cơ GHS, thành phần, sơ cứu, chữa cháy, xử lý tràn đổ, lưu trữ, PPE, tính chất lý hóa, độc tính, vận chuyển và thải bỏ.\n\nKhi đọc SDS, ưu tiên các mục: nguy cơ GHS, sơ cứu, PPE, lưu trữ, xử lý tràn đổ và tương kỵ hóa chất.`;
}

function buildStorageResponse(chem) {
  if (chem) {
    return `🏷️ **Lưu trữ ${chem.formula} - ${chem.name}**\n\n${chem.storage}\n\n**Lưu ý:** dán nhãn rõ, đóng kín nắp, tách nhóm tương kỵ, kiểm tra rò rỉ định kỳ và luôn để SDS gần khu vực sử dụng.`;
  }
  return `🏷️ **Nguyên tắc lưu trữ hóa chất**\n\n- Tách axit, bazơ, chất oxy hóa, dung môi dễ cháy và chất độc thành khu riêng.\n- Không để hóa chất theo alphabet nếu chúng tương kỵ.\n- Dán nhãn đầy đủ: tên, công thức, nồng độ, ngày nhận/mở, người phụ trách.\n- Dùng tủ hút/tủ cháy/tủ axit đúng loại và có khay chống tràn.`;
}

// ═══════════════════════════════════════
// 5. TÍCH HỢP PUBCHEM PUG REST API
// ═══════════════════════════════════════

function extractPubChemQuery(question) {
  const formulaText = question.replace(/[₀₁₂₃₄₅₆₇₈₉]/g, ch => SUBSCRIPT_DIGITS[ch] || ch);
  const formulaTokens = formulaText.match(/\b(?:[A-Z][a-z]?\d*)+\b/g) || [];
  const formulaMatch = formulaTokens.find(isValidFormula);
  if (formulaMatch) return formulaMatch;

  return normalizeText(question)
    .replace(/\b(la gi|tim|tra cuu|cho toi biet|thong tin|hoa chat|chat|ve|cua|msds|sds|ppe|bao quan|luu tru|so cuu|nguy hiem|khong)\b/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractChemicalQuery(question) {
  const formulaText = question.replace(/[₀₁₂₃₄₅₆₇₈₉]/g, ch => SUBSCRIPT_DIGITS[ch] || ch);
  const formulaTokens = [...formulaText.matchAll(/(?:^|[^\p{L}\p{N}])((?:[A-Z][a-z]?\d*)+)(?=$|[^\p{L}\p{N}])/gu)]
    .map(match => match[1]);
  const formulaMatch = formulaTokens.find(isValidFormula);
  if (formulaMatch) return formulaMatch;

  return normalizeText(question)
    .replace(/\b(la gi|tim|tra cuu|cho toi biet|thong tin|hoa chat|chat|ve|cua|msds|sds|ppe|bao quan|luu tru|so cuu|nguy hiem|khong)\b/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchPubChemJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`PubChem HTTP ${response.status}`);
  return response.json();
}

function getPubChemProperty(data) {
  return data?.PropertyTable?.Properties?.[0] || null;
}

async function fetchPubChemCompound(query) {
  const cleanQuery = query.trim();
  if (!cleanQuery) return null;

  const propertyUrl = `${PUBCHEM_PUG_BASE}/compound/name/${encodeURIComponent(cleanQuery)}/property/${PUBCHEM_PROPERTIES}/JSON`;
  try {
    const data = await fetchPubChemJson(propertyUrl);
    const compound = getPubChemProperty(data);
    if (compound) return compound;
  } catch (err) {
    // Nếu tìm theo tên không được, thử theo công thức bên dưới
  }

  if (!looksLikeFormula(cleanQuery)) return null;

  const cidsUrl = `${PUBCHEM_PUG_BASE}/compound/fastformula/${encodeURIComponent(cleanQuery)}/cids/JSON`;
  const cidsData = await fetchPubChemJson(cidsUrl);
  const cid = cidsData?.IdentifierList?.CID?.[0];
  if (!cid) return null;

  const cidPropertyUrl = `${PUBCHEM_PUG_BASE}/compound/cid/${cid}/property/${PUBCHEM_PROPERTIES}/JSON`;
  const data = await fetchPubChemJson(cidPropertyUrl);
  return getPubChemProperty(data);
}

function buildPubChemResponse(compound, query) {
  const name = compound.Title || compound.IUPACName || query;
  const formula = compound.MolecularFormula || "Không rõ";
  const weight = compound.MolecularWeight ? `${compound.MolecularWeight} g/mol` : "Không rõ";
  const cidLine = compound.CID ? `\n\n**PubChem CID:** ${compound.CID}` : "";

  return `🔎 **${name}**\n\n**Công thức:** ${formula}\n\n**Khối lượng mol:** ${weight}\n\n**Cảnh báo nguy hiểm:** Chưa có hồ sơ an toàn local trong \`chemdata.js\`. Hãy kiểm tra SDS/GHS chính thức trước khi sử dụng.\n\n**PPE:** Kính bảo hộ, găng tay phù hợp hóa chất, áo blouse; thao tác trong tủ hút nếu chất bay hơi, có mùi mạnh hoặc chưa rõ độc tính.\n\n**Bảo quản:** Đóng kín, dán nhãn rõ ràng, để nơi khô mát và tách khỏi axit/bazơ/chất oxy hóa/dung môi dễ cháy theo SDS.\n\n**Sơ cứu:** Dính da/mắt rửa nước 15-20 phút; hít phải đưa ra nơi thoáng khí; nuốt phải không tự gây nôn và liên hệ y tế/chống độc.${cidLine}`;
}

// ═══════════════════════════════════════
// 6. CALCULATOR TUTOR PHÂN TÍCH CHO AI
// ═══════════════════════════════════════

function buildCalculatorTutorResponse(question) {
  const chemicalMatch = question.match(/- Tên:\s*(.+)/);
  const formulaMatch = question.match(/- Công thức:\s*(.+)/);
  const molarMatch = question.match(/- Khối lượng mol:\s*([\d.]+)/);
  const massMatch = question.match(/- Khối lượng:\s*([\d.]+)/);
  const molesMatch = question.match(/- Số mol:\s*([\d.]+)/);
  const volumeMatch = question.match(/- Thể tích dung dịch:\s*([\d.]+)/);
  const resultMolesMatch = question.match(/Số mol:\s*([\d.]+)/);
  const molarityMatch = question.match(/Nồng độ mol:\s*([\d.]+)/);

  const chemical = chemicalMatch ? chemicalMatch[1].trim() : "hóa chất";
  const formula = formulaMatch ? formulaMatch[1].trim() : "";
  const molarMass = molarMatch ? Number(molarMatch[1]) : null;
  const mass = massMatch ? Number(massMatch[1]) : null;
  const moles = molesMatch ? Number(molesMatch[1]) : null;
  const volume = volumeMatch ? Number(volumeMatch[1]) : null;
  const resultMoles = resultMolesMatch ? Number(resultMolesMatch[1]) : null;
  const molarity = molarityMatch ? Number(molarityMatch[1]) : null;

  let response = `🧪 **PHÂN TÍCH BÀI TOÁN TỪ CALCULATOR**\n\n---\n\n### 📌 1. Dữ kiện\n\n**Hóa chất:** ${chemical}\n**Công thức:** ${formula || "Không xác định"}\n**Khối lượng mol:** ${molarMass !== null ? molarMass.toFixed(4) + " g/mol" : "Không xác định"}\n`;

  if (mass !== null && molarMass !== null) {
    const calculatedMoles = mass / molarMass;
    response += `\n### 📐 2. Tính số mol\n\nKhi biết khối lượng của chất, ta sử dụng công thức:\n\n**n = m / M**\n\nTrong đó:\n- **n**: số mol (mol)\n- **m**: khối lượng chất (g)\n- **M**: khối lượng mol (g/mol)\n\nThay số:\n**n = ${mass} / ${molarMass.toFixed(4)}**\n→ **n ≈ ${calculatedMoles.toFixed(6)} mol**\n`;

    if (resultMoles !== null) {
      const difference = Math.abs(calculatedMoles - resultMoles);
      if (difference < 0.00001) {
        response += `\n✅ **Kiểm tra:** Kết quả Calculator chính xác: **n = ${resultMoles.toFixed(6)} mol**\n`;
      } else {
        response += `\n⚠️ **Kiểm tra:** Có chênh lệch nhỏ. Giá trị tính lại: **n ≈ ${calculatedMoles.toFixed(6)} mol**\n`;
      }
    }
  }

  if (volume !== null && volume > 0 && resultMoles !== null) {
    const calculatedMolarity = resultMoles / volume;
    response += `\n### 🧪 3. Tính nồng độ mol\n\nCông thức:\n**C = n / V**\n\nTrong đó:\n- **C**: nồng độ mol (mol/L hoặc M)\n- **n**: số mol (mol)\n- **V**: thể tích dung dịch (L)\n\nThay số:\n**C = ${resultMoles.toFixed(6)} / ${volume}**\n→ **C ≈ ${calculatedMolarity.toFixed(6)} M**\n`;
    if (molarity !== null) {
      response += `\n✅ **Kết quả Calculator:** ${molarity.toFixed(6)} M\n`;
    }
  }

  response += `\n---\n\n### 💡 4. Mẹo ghi nhớ tam giác n - m - M:\n\n        m\n      ─────\n      n × M\n\nSuy ra: **n = m / M** | **m = n × M** | **M = m / n**\n\n### 🎯 Tóm tắt\nLuôn chú ý đổi đúng đơn vị: khối lượng (g), thể tích (L), nồng độ (M = mol/L).`;

  return response;
}

// ═══════════════════════════════════════
// 7. TRÌNH XỬ LÝ CHAT & LOGIC PHẢN HỒI
// ═══════════════════════════════════════

function getLocalChatResponse(question) {
  window.lastMatchedChem = null;
  window.lastMatchedMix = null;

  if (question.includes("Tôi đang học Hóa học và vừa sử dụng Chemistry Calculator")) {
    return buildCalculatorTutorResponse(question);
  }

  const normalized = normalizeText(question);
  const mentioned = findMentionedChemicals(question);
  const isMixQuestion =
    normalized.includes("tron") ||
    normalized.includes("ket hop") ||
    normalized.includes("pha") ||
    question.includes("+");

  const isFirstAidQuestion = [
    "so cuu", "do ra da", "dinh da", "vao mat", "hit phai", "nuot",
    "tiep xuc", "bi ban", "tran do", "do hoa chat", "hoa chat ban"
  ].some(phrase => normalized.includes(phrase));

  const isStorageQuestion = [
    "luu tru", "bao quan", "cat giu", "cach luu", "de hoa chat"
  ].some(phrase => normalized.includes(phrase));

  const gradeAsk = normalized.match(/\blop\s*(6|7|8|9|10|11|12)\b/);
  if (gradeAsk && mentioned.length === 0) {
    return buildGradeListResponse(Number(gradeAsk[1]));
  }

  if (
    normalized.includes("cam tron") ||
    normalized.includes("khong duoc tron") ||
    normalized.includes("tuyet doi khong")
  ) {
    return buildCommonWarningsResponse();
  }

  if ((isMixQuestion || mentioned.length >= 2) && mentioned.length >= 2) {
    return buildMixResponse(mentioned[0], mentioned[1]);
  }

  if (normalized.includes("msds") || normalized.includes("sds")) {
    return buildMsdsResponse(mentioned[0]);
  }

  if (isFirstAidQuestion) {
    return buildFirstAidResponse();
  }

  if (isStorageQuestion) {
    return buildStorageResponse(mentioned[0]);
  }

  if (mentioned.length > 0) {
    window.lastMatchedChem = mentioned[0];
    return buildChemicalInfoResponse(mentioned[0]);
  }

  return null;
}

async function getChatResponse(question) {
  // 1. Kiểm tra CSDL local & quy tắc định sẵn
  const localResponse = getLocalChatResponse(question);
  if (localResponse) return localResponse;

  // 2. Kiểm tra chất ngoài phạm vi lớp học đang chọn
  if (currentGrade !== "all") {
    const hidden = findMentionedChemicals(question, true);
    if (hidden.length) {
      const c = hidden[0];
      return `📚 **${c.formula} (${c.name})** chưa thuộc phạm vi **Lớp 6–${currentGrade}** bạn đang chọn.\n\n**Chương trình học:** ${formatGradeTopics(c)}\n\nĐổi ô **Lớp học** ở thanh bên trái sang lớp cao hơn hoặc **Tất cả** để xem thông tin đầy đủ.`;
    }
  }

  // 3. Nếu có Backend Ollama Server (/api/chat) đang chạy, thử gọi API trước
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: question,
        history: conversationHistory
      })
    });
    if (response.ok) {
      const data = await response.json();
      if (data && data.answer) return data.answer;
    }
  } catch (err) {
    // Server backend không chạy -> chuyển sang PubChem / fallback offline
  }

  // 4. Tìm kiếm thông tin từ PubChem PUG REST
  const query = extractPubChemQuery(question) || extractChemicalQuery(question);
  if (query) {
    try {
      const compound = await fetchPubChemCompound(query);
      if (compound) return buildPubChemResponse(compound, query);
    } catch (err) {
      console.warn("PubChem lookup error:", err);
    }
  }

  if (!query) {
    return `Tôi chưa nhận ra tên hoặc công thức hóa chất trong câu hỏi.\n\nBạn có thể nhập kiểu: \`HCl\`, \`NaOH\`, \`H2SO4\`, \`benzene\`, \`acetone\`.`;
  }

  return `Không tìm thấy **${query}** trong cơ sở dữ liệu local (\`chemdata.js\`, ${getUniqueChemicalCatalog().length} chất) hoặc PubChem.\n\nHãy thử tên tiếng Việt/tiếng Anh hoặc công thức chuẩn, ví dụ \`HCl\`, \`sodium hydroxide\`, \`C6H6\`, hoặc xem danh sách ở tab **Cơ sở dữ liệu**. Với chất ngoài danh sách, hãy đối chiếu SDS/GHS chính thức của nhà cung cấp.`;
}

async function sendMessage() {
  const sendBtn = document.getElementById("send-btn");
  if (sendBtn && sendBtn.disabled) return;

  const input = document.getElementById("chat-input");
  const text = input ? input.value.trim() : "";
  if (!text) return;

  if (sendBtn) sendBtn.disabled = true;
  input.value = "";
  input.style.height = "auto";

  // Hiển thị tin nhắn người dùng
  appendMessage("user", text);
  conversationHistory.push({ role: "user", content: text });

  const typingId = showTyping();

  try {
    const botReply = await getChatResponse(text);
    removeTyping(typingId);
    conversationHistory.push({ role: "assistant", content: botReply });
    const bubble = appendMessage("bot", botReply);

    // Gắn các nút hỗ trợ tương tác nếu có
    if (window.lastMatchedChem) {
      if (typeof attachMol3DButton === "function") {
        attachMol3DButton(window.lastMatchedChem, bubble);
      }
      attachVideoButton(window.lastMatchedChem, bubble);
    }
    attachReactionVideoButton(window.lastMatchedMix, bubble);
    attachExperimentButton(window.lastMatchedMix, bubble);

    // Tự động phát giọng đọc (nếu bật)
    if (autoSpeakAI) {
      speakAIResponse(botReply);
    }
  } catch (err) {
    removeTyping(typingId);
    appendMessage("bot", "❌ Có lỗi khi xử lý câu hỏi. Mở Console (F12) để xem chi tiết.");
    console.error("Lookup error:", err);
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
}

function sendQuick(text) {
  const chatBtn = document.querySelector('[data-tab="chat"]');
  if (chatBtn) switchTab("chat", chatBtn);

  const input = document.getElementById("chat-input");
  if (!input) return;
  input.value = text;
  autoResize(input);
  sendMessage();
}

function clearChat() {
  conversationHistory = [];
  const msgs = document.getElementById("chat-messages");
  if (!msgs) return;
  msgs.innerHTML = `
    <div class="msg bot">
      <div class="msg-avatar">AI</div>
      <div class="msg-content">
        <div class="msg-bubble">
          Cuộc trò chuyện đã được xóa. Tôi sẵn sàng hỗ trợ bạn!<br><br>
          Hãy đặt câu hỏi về hóa chất bất cứ lúc nào. 🔬
        </div>
        <div class="msg-time">Hệ thống</div>
      </div>
    </div>`;
}

function appendMessage(role, text) {
  const msgs = document.getElementById("chat-messages");
  if (!msgs) return null;
  const now = new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });

  const div = document.createElement("div");
  div.className = "msg " + role;

  const formatted = formatMessageText(text);
  const avatarLabel = role === "bot" ? "AI" : "BẠN";

  div.innerHTML = `
    <div class="msg-avatar">${avatarLabel}</div>
    <div class="msg-content">
      <div class="msg-bubble">${formatted}</div>
      <div class="msg-time">${now}</div>
    </div>`;

  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return div.querySelector(".msg-bubble");
}

function showTyping() {
  const msgs = document.getElementById("chat-messages");
  if (!msgs) return null;
  const id = "typing-" + Date.now();
  const div = document.createElement("div");
  div.className = "msg bot";
  div.id = id;
  div.innerHTML = `
    <div class="msg-avatar">AI</div>
    <div class="msg-content">
      <div class="msg-bubble">
        <div class="typing-indicator">
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
        </div>
      </div>
    </div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return id;
}

function removeTyping(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

// ═══════════════════════════════════════
// 8. NHẬN DIỆN & PHÁT GIỌNG NÓI (VOICE)
// ═══════════════════════════════════════

function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return null;

  const recognition = new SpeechRecognition();
  recognition.lang = "vi-VN";
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = function () {
    isListening = true;
    const voiceBtn = document.getElementById("voice-btn");
    if (voiceBtn) {
      voiceBtn.classList.add("listening");
      voiceBtn.textContent = "🔴";
    }
    updateVoiceStatus("🎤 Đang nghe... Hãy nói câu hỏi của bạn.");
  };

  recognition.onresult = function (event) {
    const transcript = event.results[0][0].transcript.trim();
    const input = document.getElementById("chat-input");
    if (!input || !transcript) return;
    input.value = transcript;
    autoResize(input);
    updateVoiceStatus("✅ Đã nhận: " + transcript);
    sendMessage();
  };

  recognition.onerror = function (event) {
    console.error("Speech Recognition Error:", event.error);
    let message = "❌ Không thể nhận dạng giọng nói.";
    if (event.error === "not-allowed") message = "⚠️ Chưa được cấp quyền microphone.";
    if (event.error === "no-speech") message = "⚠️ Không phát hiện giọng nói.";
    if (event.error === "audio-capture") message = "⚠️ Không tìm thấy microphone.";
    updateVoiceStatus(message);
  };

  recognition.onend = function () {
    isListening = false;
    const voiceBtn = document.getElementById("voice-btn");
    if (voiceBtn) {
      voiceBtn.classList.remove("listening");
      voiceBtn.textContent = "🎤";
    }
  };

  return recognition;
}

function toggleVoiceInput() {
  if (!window.SpeechRecognition && !window.webkitSpeechRecognition) {
    updateVoiceStatus("❌ Trình duyệt không hỗ trợ nhận dạng giọng nói (thử Chrome/Edge).");
    return;
  }

  if (isListening) {
    if (speechRecognition) speechRecognition.stop();
    return;
  }

  if (!speechRecognition) speechRecognition = initSpeechRecognition();
  if (!speechRecognition) {
    updateVoiceStatus("❌ Không thể khởi tạo microphone.");
    return;
  }

  try {
    speechRecognition.start();
  } catch (error) {
    console.error("Cannot start speech recognition:", error);
    updateVoiceStatus("⚠️ Microphone đang bận. Hãy thử lại.");
  }
}

function updateVoiceStatus(message) {
  const status = document.getElementById("voice-status");
  if (status) status.textContent = message;
}

function cleanTextForSpeech(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^[\s]*[-*•]\s*/gm, "")
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function speakAIResponse(text) {
  if (!("speechSynthesis" in window) || !autoSpeakAI) return;
  window.speechSynthesis.cancel();

  const cleanText = cleanTextForSpeech(text);
  if (!cleanText) return;

  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.lang = "vi-VN";
  utterance.rate = 0.95;
  utterance.pitch = 1;
  utterance.volume = 1;

  const voices = window.speechSynthesis.getVoices();
  const vietnameseVoice = voices.find(
    voice => voice.lang && voice.lang.toLowerCase().startsWith("vi")
  );
  if (vietnameseVoice) utterance.voice = vietnameseVoice;

  utterance.onstart = () => updateVoiceStatus("🔊 ChemSafe AI đang đọc câu trả lời...");
  utterance.onend = () => updateVoiceStatus("✅ Đã đọc xong câu trả lời.");
  utterance.onerror = () => updateVoiceStatus("⚠️ Không thể phát âm thanh.");

  window.speechSynthesis.speak(utterance);
}

function stopAIResponse() {
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    updateVoiceStatus("⏹ Đã dừng đọc.");
  }
}

// ═══════════════════════════════════════
// 9. QUẢN LÝ TẢI FILE TRONG CHAT
// ═══════════════════════════════════════

function handleAIFileUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
  if (file.size > MAX_SIZE) {
    alert("File quá lớn. Vui lòng chọn file dưới 10 MB.");
    event.target.value = "";
    return;
  }

  currentAIFile = file;
  showAIFilePreview(file);
}

function showAIFilePreview(file) {
  const preview = document.getElementById("ai-file-preview");
  if (!preview) return;

  const fileSize = formatAIFileSize(file.size);
  const isImage = file.type.startsWith("image/");
  let icon = "📄";

  if (file.type === "application/pdf") icon = "📕";
  else if (
    file.type.includes("word") ||
    file.name.toLowerCase().endsWith(".doc") ||
    file.name.toLowerCase().endsWith(".docx")
  ) {
    icon = "📝";
  } else if (file.type === "text/plain") {
    icon = "📃";
  } else if (isImage) {
    icon = "🖼️";
  }

  let fileVisual = `<div class="ai-file-icon">${icon}</div>`;
  if (isImage) {
    const imageURL = URL.createObjectURL(file);
    fileVisual = `<img src="${imageURL}" class="ai-file-image" alt="Preview ảnh" />`;
  }

  preview.innerHTML = `
    <div class="ai-file-item">
      ${fileVisual}
      <div class="ai-file-info">
        <span class="ai-file-name">${escapeHtml(file.name)}</span>
        <span class="ai-file-size">${fileSize}</span>
      </div>
      <button type="button" class="ai-file-remove" onclick="removeAIFile()" title="Xóa file">✕</button>
    </div>
  `;
  preview.classList.add("show");
}

function removeAIFile() {
  currentAIFile = null;
  const input = document.getElementById("ai-file-upload");
  if (input) input.value = "";
  const preview = document.getElementById("ai-file-preview");
  if (preview) {
    preview.innerHTML = "";
    preview.classList.remove("show");
  }
}

function formatAIFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ═══════════════════════════════════════
// 10. MODAL MÔ PHỎNG THÍ NGHIỆM & VIDEO
// ═══════════════════════════════════════

function attachVideoButton(chem, bubbleElement) {
  if (!chem || !bubbleElement) return;

  const chemKey = chem.key || compactFormula(chem.formula);
  const videoMap = typeof VIDEO_DATABASE !== "undefined" ? VIDEO_DATABASE : {};
  const videoUrl = videoMap[chemKey] || chem.videoUrl;

  if (bubbleElement.querySelector(".btn-video-chip") || !videoUrl) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-video-chip";
  btn.style.cssText = `
    display: inline-flex; align-items: center; gap: 6px;
    margin-top: 10px; margin-right: 8px; padding: 5px 12px;
    background: rgba(16, 163, 127, 0.1); border: 1px solid #10a37f;
    border-radius: 12px; color: #10a37f; font-size: 13px;
    font-weight: 500; cursor: pointer; transition: all 0.2s ease;
  `;
  btn.innerHTML = `🎬 Xem video`;
  btn.onclick = () => openVideoModal(chem.name || chem.formula, videoUrl);

  bubbleElement.appendChild(btn);
}

function attachReactionVideoButton(reaction, bubbleElement) {
  if (!reaction || !bubbleElement || !reaction.key) return;

  const videoMap = typeof VIDEO_DATABASE !== "undefined" ? VIDEO_DATABASE : {};
  const warning = typeof MIX_WARNINGS !== "undefined" ? MIX_WARNINGS[reaction.key] : null;
  const videoUrl = videoMap[reaction.key] || warning?.videoUrl;
  if (!videoUrl || bubbleElement.querySelector(".btn-reaction-video-chip")) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-reaction-video-chip btn-video-chip";
  btn.style.cssText = `
    display: inline-flex; align-items: center; gap: 6px;
    margin-top: 10px; margin-right: 8px; padding: 5px 12px;
    background: rgba(16, 163, 127, 0.1); border: 1px solid #10a37f;
    border-radius: 12px; color: #10a37f; font-size: 13px;
    font-weight: 500; cursor: pointer;
  `;
  btn.textContent = "🎬 Xem video phản ứng";
  btn.onclick = () =>
    openVideoModal(`${reaction.first.formula} + ${reaction.second.formula}`, videoUrl);
  bubbleElement.appendChild(btn);
}

function attachExperimentButton(reaction, bubbleElement) {
  if (!reaction || !bubbleElement || !reaction.key) return;

  const exp = EXPERIMENT_DATABASE[reaction.key];
  if (!exp || bubbleElement.querySelector(".btn-exp-chip")) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-exp-chip";
  btn.style.cssText = `
    display: inline-flex; align-items: center; gap: 6px;
    margin-top: 10px; margin-right: 8px; padding: 5px 12px;
    background: rgba(30, 111, 217, 0.1); border: 1px solid #1e6fd9;
    border-radius: 12px; color: #1e6fd9; font-size: 13px;
    font-weight: 500; cursor: pointer;
  `;
  btn.textContent = "🧪 Xem video & tự làm thí nghiệm";
  btn.onclick = () => openExperimentModal(exp.title, exp.src);
  bubbleElement.appendChild(btn);
}

function openExperimentModal(title, src) {
  let modal = document.getElementById("chem-exp-modal");

  if (!modal) {
    modal = document.createElement("div");
    modal.id = "chem-exp-modal";
    modal.style.cssText = `
      position: fixed; inset: 0; background: rgba(0, 0, 0, 0.75);
      display: flex; justify-content: center; align-items: center;
      z-index: 9999; opacity: 0; transition: opacity 0.2s ease;
    `;
    modal.innerHTML = `
      <div style="position:relative;width:96%;max-width:1180px;height:92vh;background:#1e1e24;border-radius:12px;padding:16px;border:1px solid #333;display:flex;flex-direction:column">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <h3 id="exp-modal-title" style="margin:0;font-size:16px;color:#fff"></h3>
          <button type="button" aria-label="Đóng" onclick="closeExperimentModal()" style="background:transparent;border:0;color:#aaa;font-size:24px;cursor:pointer;padding:0 6px">&times;</button>
        </div>
        <div id="exp-modal-container" style="flex:1;width:100%;border-radius:8px;overflow:hidden;background:#fff"></div>
      </div>
    `;
    modal.onclick = event => {
      if (event.target === modal) closeExperimentModal();
    };
    document.body.appendChild(modal);
  }

  modal.querySelector("#exp-modal-title").textContent = title;
  const container = modal.querySelector("#exp-modal-container");
  container.innerHTML = "";
  const iframe = document.createElement("iframe");
  iframe.title = title;
  iframe.src = src;
  iframe.style.cssText = "width:100%;height:100%;border:0";
  container.appendChild(iframe);

  modal.style.display = "flex";
  setTimeout(() => { modal.style.opacity = "1"; }, 10);
}

function closeExperimentModal() {
  const modal = document.getElementById("chem-exp-modal");
  if (!modal) return;
  modal.style.opacity = "0";
  setTimeout(() => {
    modal.style.display = "none";
    const container = modal.querySelector("#exp-modal-container");
    if (container) container.innerHTML = "";
  }, 200);
}

function openVideoModal(title, videoUrl) {
  let modal = document.getElementById("chem-video-modal");

  if (!modal) {
    modal = document.createElement("div");
    modal.id = "chem-video-modal";
    modal.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0, 0, 0, 0.75); display: flex; justify-content: center;
      align-items: center; z-index: 9999; opacity: 0; transition: opacity 0.2s ease;
    `;
    modal.innerHTML = `
      <div style="position: relative; width: 90%; max-width: 650px; background: #1e1e24; border-radius: 12px; padding: 16px; border: 1px solid #333;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <h3 id="video-modal-title" style="margin: 0; font-size: 16px; color: #fff;">Xem Video</h3>
          <span style="color: #aaa; font-size: 24px; cursor: pointer; line-height: 1;" onclick="closeVideoModal()">&times;</span>
        </div>
        <div id="video-modal-container" style="width: 100%; border-radius: 8px; overflow: hidden; background: #000;"></div>
      </div>
    `;
    modal.onclick = e => { if (e.target === modal) closeVideoModal(); };
    document.body.appendChild(modal);
  }

  const titleEl = modal.querySelector("#video-modal-title");
  const container = modal.querySelector("#video-modal-container");
  if (titleEl) titleEl.textContent = `Video: ${title}`;

  const youtubeMatch = videoUrl.match(
    /(?:youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtu\.be\/)([A-Za-z0-9_-]{11})/
  );
  if (youtubeMatch) {
    const embedUrl = `https://www.youtube.com/embed/${youtubeMatch[1]}`;
    container.innerHTML = `<iframe src="${embedUrl}" width="100%" height="360" frameborder="0" allowfullscreen></iframe>`;
  } else {
    container.innerHTML = `
      <video controls autoplay style="width:100%; max-height:360px;">
        <source src="${videoUrl}" type="video/mp4">
        Trình duyệt không hỗ trợ phát video này.
      </video>`;
  }

  modal.style.display = "flex";
  setTimeout(() => { modal.style.opacity = "1"; }, 10);
}

function closeVideoModal() {
  const modal = document.getElementById("chem-video-modal");
  if (modal) {
    modal.style.opacity = "0";
    setTimeout(() => {
      modal.style.display = "none";
      const container = modal.querySelector("#video-modal-container");
      if (container) container.innerHTML = "";
    }, 200);
  }
}

// ═══════════════════════════════════════
// 11. TAB CẢNH BÁO NGUY HIỂM (MIX WARNING)
// ═══════════════════════════════════════

function getMixGroupLabel(chem) {
  const text = normalizeText(`${chem.formula} ${chem.name} ${chem.properties} ${chem.msds}`);
  const formula = compactFormula(chem.formula);

  if (text.includes("khi ") || text.includes("gas") || ["cl2", "nh3", "h2s", "so2", "co", "co2", "o2", "h2", "n2"].includes(formula)) return "Khí";
  if (text.includes("axit") || text.includes("acid") || ["hcl", "h2so4", "hno3", "hf", "hbr", "hi", "hclo4"].includes(formula)) return "Axit";
  if (text.includes("kiem") || text.includes("hydroxide") || text.includes("amoniac")) return "Bazơ / kiềm";
  if (text.includes("oxy hoa") || text.includes("hypochlorite") || text.includes("nitrate") || text.includes("nitrite") || text.includes("perchloric")) return "Oxy hóa / nitrate";
  if (text.includes("dung moi") || text.includes("de chay") || text.includes("solvent") || text.includes("alcohol") || text.includes("ether")) return "Dung môi / hữu cơ";
  if (text.includes("kim loai") || ["mg", "zn", "al", "fe", "cu", "p", "s", "c"].includes(formula)) return "Kim loại / nguyên tố";
  if (text.includes("muoi") || text.includes("chloride") || text.includes("sulfate") || text.includes("carbonate") || text.includes("fluoride")) return "Muối vô cơ";
  return "Khác";
}

function renderMixOptions() {
  const selects = [document.getElementById("chem1"), document.getElementById("chem2")].filter(Boolean);
  if (!selects.length) return;

  const groupOrder = ["Axit", "Bazơ / kiềm", "Oxy hóa / nitrate", "Dung môi / hữu cơ", "Khí", "Muối vô cơ", "Kim loại / nguyên tố", "Khác"];
  const groups = Object.fromEntries(groupOrder.map(group => [group, []]));
  getUniqueChemicalCatalog().forEach(chem => {
    const group = getMixGroupLabel(chem);
    (groups[group] || groups["Khác"]).push(chem);
  });

  const optionsHtml = `<option value="">— Chọn hóa chất —</option>` + groupOrder
    .filter(group => groups[group].length)
    .map(group => {
      const options = groups[group]
        .sort((a, b) => a.formula.localeCompare(b.formula, "vi"))
        .map(chem => `<option value="${escapeHtml(chem.key)}">${escapeHtml(`${chem.formula} — ${chem.name}`)}</option>`)
        .join("");
      return `<optgroup label="${escapeHtml(group)}">${options}</optgroup>`;
    })
    .join("");

  selects.forEach(select => {
    const selected = select.value;
    select.innerHTML = optionsHtml;
    if (selected) select.value = selected;
  });
}

function renderCommonWarnings() {
  const list = document.getElementById("common-warnings");
  if (!list || typeof MIX_WARNINGS === "undefined") return;

  const priority = [
    "naclo|hcl", "naclo|nh3", "na2s|hcl", "nano2|hcl", "hclo4|ethanol",
    "h2|o2", "h2s|cl2", "hcl|naoh", "h2so4|naoh", "hno3|ethanol",
    "h2o2|acetone", "cl2|nh3", "h2so4|h2o2", "k2cr2o7|h2so4"
  ];
  const orderedKeys = [
    ...priority.filter(key => MIX_WARNINGS[key]),
    ...Object.keys(MIX_WARNINGS).filter(key => !priority.includes(key))
  ].slice(0, 16);

  list.innerHTML = orderedKeys.map(key => {
    const warning = MIX_WARNINGS[key];
    const [first, second] = key.split("|");
    const badgeClass = warning.level === "caution" ? "amber" : "red";
    const badgeText = warning.level === "caution" ? "THẬN TRỌNG" : "NGUY HIỂM";
    const pair = `${getChemShortLabel(first)} + ${getChemShortLabel(second)}`;
    const desc = warning.desc.split(".")[0];

    return `
      <div class="warn-item ${escapeHtml(warning.level)}" onclick="loadWarn('${first}','${second}')">
        <div class="warn-badge ${badgeClass}">${badgeText}</div>
        <div class="warn-info">
          <div class="warn-name">${escapeHtml(pair)}</div>
          <div class="warn-desc">${escapeHtml(desc)}</div>
        </div>
      </div>`;
  }).join("");
}

function loadWarn(c1, c2) {
  ["chem1", "chem2"].forEach((id, i) => {
    const sel = document.getElementById(id);
    const key = i === 0 ? c1 : c2;
    if (sel && ![...sel.options].some(o => o.value === key)) {
      const chem = getChemByKey(key);
      sel.insertAdjacentHTML(
        "beforeend",
        `<option value="${escapeHtml(key)}">${escapeHtml(`${chem ? chem.formula + " — " + chem.name : key} (ngoài lớp đang chọn)`)}</option>`
      );
    }
  });
  const s1 = document.getElementById("chem1");
  const s2 = document.getElementById("chem2");
  if (s1) s1.value = c1;
  if (s2) s2.value = c2;
  autoCheck();
}

function autoCheck() {
  const c1 = document.getElementById("chem1")?.value;
  const c2 = document.getElementById("chem2")?.value;
  const resultEl = document.getElementById("mix-result");
  if (!resultEl || !c1 || !c2) return;

  if (c1 === c2) {
    resultEl.innerHTML = `
      <div class="result-card neutral">
        <div class="result-title">— Cùng một chất</div>
        Không có phản ứng đặc biệt khi trộn một chất với chính nó.
      </div>`;
    return;
  }

  const key = typeof getMixKey === "function" ? getMixKey(c1, c2) : null;
  if (key && typeof MIX_WARNINGS !== "undefined" && MIX_WARNINGS[key]) {
    const w = MIX_WARNINGS[key];
    const tags = (w.tags || []).map(t => `<span class="rtag">${escapeHtml(t)}</span>`).join("");
    resultEl.innerHTML = `
      <div class="result-card ${escapeHtml(w.level)}">
        <div class="result-title">${escapeHtml(w.title)}</div>
        <div style="font-family:var(--font-mono);font-size:12px;color:var(--text-secondary);margin-bottom:8px">${escapeHtml(w.reaction)}</div>
        ${escapeHtml(w.desc)}
        <div class="result-tags">${tags}</div>
      </div>`;
  } else {
    resultEl.innerHTML = `
      <div class="result-card safe">
        <div class="result-title">✅ Không có cảnh báo đặc biệt</div>
        Tổ hợp này không nằm trong danh sách nguy hiểm đã biết. Tuy nhiên vẫn cần tuân thủ quy trình an toàn cơ bản. Nhấn "Phân tích bằng chatbot" để kiểm tra chi tiết hơn.
      </div>`;
  }
}

async function analyzeWithAI() {
  const c1 = document.getElementById("chem1")?.value;
  const c2 = document.getElementById("chem2")?.value;
  if (!c1 || !c2) {
    alert("Vui lòng chọn 2 hóa chất trước!");
    return;
  }
  const question = `Phân tích nguy hiểm khi trộn ${getChemLabel(c1)} với ${getChemLabel(c2)}. Cho biết: phản ứng xảy ra, mức độ nguy hiểm, biện pháp an toàn và PPE cần thiết.`;
  sendQuick(question);
}

// ═══════════════════════════════════════
// 12. TAB TẠO MÃ QR & NHÃN DÁN AN TOÀN
// ═══════════════════════════════════════

function updateQRPreview() {
  const name = document.getElementById("qr-name")?.value || "Tên hóa chất";
  const formula = document.getElementById("qr-formula")?.value || "???";
  const danger = document.getElementById("qr-danger")?.value || "safe";
  const location = document.getElementById("qr-location")?.value || "Chưa xác định";
  const contact = document.getElementById("qr-contact")?.value || "Chưa có";

  const nameEl = document.getElementById("qr-preview-name");
  const formulaEl = document.getElementById("qr-preview-formula");
  const locEl = document.getElementById("qr-prev-location");
  const contactEl = document.getElementById("qr-prev-contact");
  const dateEl = document.getElementById("qr-prev-date");

  if (nameEl) nameEl.textContent = name;
  if (formulaEl) formulaEl.textContent = formula;
  if (locEl) locEl.textContent = location;
  if (contactEl) contactEl.textContent = contact;
  if (dateEl) dateEl.textContent = new Date().toLocaleDateString("vi-VN");

  const badge = document.getElementById("qr-preview-badge");
  const header = document.getElementById("qr-preview-header");
  const labels = {
    safe: "✅ AN TOÀN",
    caution: "⚡ THẬN TRỌNG",
    danger: "⚠️ NGUY HIỂM",
    extreme: "☠️ CỰC KỲ NGUY HIỂM"
  };

  if (badge) {
    badge.textContent = labels[danger] || labels.safe;
    badge.className = "qr-badge " + danger;
  }
  if (header) {
    header.className = "qr-preview-header " + danger;
  }

  if (formulaEl) {
    if (danger === "danger" || danger === "extreme") formulaEl.style.color = "#ff4757";
    else if (danger === "caution") formulaEl.style.color = "#ffa502";
    else formulaEl.style.color = "#2ed573";
  }
}

function generateQR() {
  const name = document.getElementById("qr-name")?.value || "Hóa chất";
  const formula = document.getElementById("qr-formula")?.value || "N/A";
  const danger = document.getElementById("qr-danger")?.value || "safe";
  const location = document.getElementById("qr-location")?.value || "N/A";
  const contact = document.getElementById("qr-contact")?.value || "N/A";
  const date = new Date().toLocaleDateString("vi-VN");

  const qrContent = `CHEMSAFE AI\nHóa chất: ${name}\nCông thức: ${formula}\nMức độ: ${danger.toUpperCase()}\nVị trí: ${location}\nKhẩn cấp: ${contact}\nNgày: ${date}\nhttps://chemsafe.ai`;

  const canvas = document.getElementById("qr-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 200, 200);

  if (typeof QRCode !== "undefined" && typeof QRCode.toCanvas === "function") {
    try {
      const newCanvas = document.createElement("canvas");
      QRCode.toCanvas(
        newCanvas,
        qrContent,
        { width: 200, margin: 2, color: { dark: "#000000", light: "#ffffff" } },
        function (err) {
          if (err) {
            drawFakeQR(ctx, formula, danger);
            return;
          }
          ctx.drawImage(newCanvas, 0, 0);
        }
      );
    } catch (err) {
      drawFakeQR(ctx, formula, danger);
    }
  } else {
    drawFakeQR(ctx, formula, danger);
  }

  updateQRPreview();
  const downloadBtn = document.getElementById("download-btn");
  if (downloadBtn) downloadBtn.disabled = false;
}

function drawFakeQR(ctx, formula, danger) {
  const colors = { safe: "#2ed573", caution: "#ffa502", danger: "#ff4757", extreme: "#111111" };
  const c = colors[danger] || "#00d4a8";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 200, 200);

  const cells = [
    [1, 1, 7, 7], [3, 3, 3, 3], [11, 1, 7, 7], [13, 3, 3, 3], [1, 11, 7, 7], [3, 13, 3, 3],
    [10, 2, 1, 1], [10, 4, 1, 1], [10, 6, 1, 1], [12, 5, 1, 1], [14, 2, 1, 1], [14, 6, 1, 1],
    [2, 10, 1, 1], [4, 10, 1, 1], [6, 10, 1, 1], [5, 12, 1, 1], [2, 14, 1, 1], [6, 14, 1, 1],
    [10, 10, 2, 2], [13, 10, 1, 1], [10, 13, 1, 1], [12, 13, 2, 1], [10, 15, 3, 1], [14, 12, 1, 3]
  ];
  ctx.fillStyle = c;
  const size = 200 / 17;
  cells.forEach(([x, y, w, h]) => {
    ctx.fillRect(x * size, y * size, w * size - 1, h * size - 1);
  });

  ctx.fillStyle = "#333";
  ctx.font = "bold 14px 'Space Mono', monospace";
  ctx.textAlign = "center";
  ctx.fillText(formula, 100, 108);
}

function downloadQR() {
  const card = document.getElementById("qr-preview-card");
  const formula = document.getElementById("qr-formula")?.value || "hoachat";

  if (typeof html2canvas !== "undefined" && card) {
    html2canvas(card, { scale: 2, backgroundColor: "#ffffff", logging: false })
      .then(canvas => {
        const a = document.createElement("a");
        a.download = `QR_${formula}_${new Date().toLocaleDateString("vi-VN").replace(/\//g, "-")}.png`;
        a.href = canvas.toDataURL("image/png");
        a.click();
      })
      .catch(err => {
        console.error("html2canvas error:", err);
        fallbackDownloadQRCanvas(formula);
      });
  } else {
    fallbackDownloadQRCanvas(formula);
  }
}

function fallbackDownloadQRCanvas(formula) {
  const canvas = document.getElementById("qr-canvas");
  if (!canvas) return;
  const a = document.createElement("a");
  a.download = `QR_${formula}.png`;
  a.href = canvas.toDataURL("image/png");
  a.click();
}

// ═══════════════════════════════════════
// 13. TAB TÍNH TOÁN HÓA HỌC (CALCULATOR)
// ═══════════════════════════════════════

let selectedCalcChemicalIndex = 0;

function renderCalcOptions() {
  const searchInput = document.getElementById("calc-chemical-search");
  const hiddenInput = document.getElementById("calc-chem");
  if (!searchInput || !hiddenInput) return;

  selectedCalcChemicalIndex = 0;
  hiddenInput.value = 0;

  const firstChemical = typeof CHEM_DATABASE !== "undefined" ? CHEM_DATABASE[0] : null;
  if (firstChemical) {
    searchInput.value = `${firstChemical.formula} - ${firstChemical.name}`;
  }

  renderCalcChemicalResults("");
  updateCalc();
}

function searchCalcChemical(keyword) {
  const results = document.getElementById("calc-chemical-results");
  if (!results) return;
  renderCalcChemicalResults(keyword);
  results.classList.add("show");
}

function showCalcChemicalResults() {
  const keyword = document.getElementById("calc-chemical-search")?.value || "";
  const results = document.getElementById("calc-chemical-results");
  if (!results) return;
  renderCalcChemicalResults(keyword);
  results.classList.add("show");
}

function renderCalcChemicalResults(keyword = "") {
  const results = document.getElementById("calc-chemical-results");
  if (!results || typeof CHEM_DATABASE === "undefined") return;

  const search = normalizeText(keyword.trim());
  let chemicals = CHEM_DATABASE.filter(chem => isChemInGrade(chem));

  if (search) {
    chemicals = chemicals.filter(chem => {
      const formula = normalizeText(chem.formula || "");
      const name = normalizeText(chem.name || "");
      return formula.includes(search) || name.includes(search);
    });
  }

  chemicals = chemicals.slice(0, 20);

  if (!chemicals.length) {
    results.innerHTML = `<div class="chemical-no-result">Không tìm thấy hóa chất</div>`;
    return;
  }

  results.innerHTML = chemicals
    .map(chem => {
      const index = CHEM_DATABASE.indexOf(chem);
      const molarMass = chem.molarMass || Number.parseFloat(chem.molar);

      return `
        <button type="button" class="chemical-search-item" onclick="selectCalcChemical(${index})">
          <div class="chemical-result-main">
            <span class="chemical-result-formula">${escapeHtml(chem.formula || "--")}</span>
            <span class="chemical-result-name">${escapeHtml(chem.name || "Không có tên")}</span>
          </div>
          <span class="chemical-result-molar">M = ${formatCalcNumber(molarMass, "g/mol")}</span>
        </button>
      `;
    })
    .join("");
}

function selectCalcChemical(index) {
  if (typeof CHEM_DATABASE === "undefined") return;
  const chem = CHEM_DATABASE[index];
  if (!chem) return;

  selectedCalcChemicalIndex = index;
  const hiddenInput = document.getElementById("calc-chem");
  if (hiddenInput) hiddenInput.value = index;

  const searchInput = document.getElementById("calc-chemical-search");
  if (searchInput) searchInput.value = `${chem.formula} - ${chem.name}`;

  const results = document.getElementById("calc-chemical-results");
  if (results) results.classList.remove("show");

  updateCalc();
}

function getSelectedCalcChemical() {
  if (typeof CHEM_DATABASE === "undefined") return null;
  const index = Number(document.getElementById("calc-chem")?.value || 0);
  return CHEM_DATABASE[index] || CHEM_DATABASE[0];
}

function readCalcNumber(id) {
  const raw = document.getElementById(id)?.value;
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function formatCalcNumber(value, unit) {
  if (!Number.isFinite(value)) return "--";
  const formatted =
    value === 0 ? "0" : value.toLocaleString("vi-VN", { maximumSignificantDigits: 6 });
  return unit ? `${formatted} ${unit}` : formatted;
}

function setCalcText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function convertMassToGram(value, unit) {
  if (value === null) return null;
  switch (unit) {
    case "mg": return value / 1000;
    case "kg": return value * 1000;
    case "g":
    default: return value;
  }
}

function convertVolumeToLiter(value, unit) {
  if (value === null) return null;
  switch (unit) {
    case "mL": return value / 1000;
    case "L":
    default: return value;
  }
}

function updateCalc() {
  const chem = getSelectedCalcChemical();
  if (!chem) return;

  const molarMass = chem.molarMass || Number.parseFloat(chem.molar);
  setCalcText("calc-formula", chem.formula);
  setCalcText("calc-name", chem.name);
  setCalcText("calc-molar-mass", formatCalcNumber(molarMass, "g/mol"));
  setCalcText("calc-danger", chem.dangerLabel);
  setCalcText("calc-ph", chem.ph);

  // 1. Tính toán Mol / Khối lượng / Nồng độ
  const massInput = readCalcNumber("calc-mass-g");
  const massUnit = document.getElementById("calc-mass-unit")?.value || "g";
  const moles = readCalcNumber("calc-moles");
  const volumeInput = readCalcNumber("calc-volume-l");
  const volumeUnit = document.getElementById("calc-volume-unit")?.value || "L";

  const mass = convertMassToGram(massInput, massUnit);
  const volume = convertVolumeToLiter(volumeInput, volumeUnit);

  const molesFromMass = mass !== null && molarMass > 0 ? mass / molarMass : NaN;
  const massFromMoles = moles !== null ? moles * molarMass : NaN;
  const baseMoles = moles !== null ? moles : molesFromMass;
  const molarity =
    Number.isFinite(baseMoles) && volume !== null && volume > 0 ? baseMoles / volume : NaN;

  setCalcText("calc-result-moles", formatCalcNumber(molesFromMass, "mol"));
  setCalcText("calc-result-mass", formatCalcNumber(massFromMoles, "g"));
  setCalcText("calc-result-molarity", formatCalcNumber(molarity, "M"));

  // 2. Pha dung dịch (Preparation)
  const targetM = readCalcNumber("calc-target-m");
  const targetVolumeInput = readCalcNumber("calc-target-volume-l");
  const targetVolumeUnit = document.getElementById("calc-target-volume-unit")?.value || "L";
  const targetVolume = convertVolumeToLiter(targetVolumeInput, targetVolumeUnit);

  const targetMoles = targetM && targetVolume ? targetM * targetVolume : NaN;
  const gramsNeeded = Number.isFinite(targetMoles) ? targetMoles * molarMass : NaN;

  setCalcText("calc-result-target-moles", formatCalcNumber(targetMoles, "mol"));
  setCalcText("calc-result-grams-needed", formatCalcNumber(gramsNeeded, "g"));

  // 3. Pha loãng dung dịch (Dilution C1V1 = C2V2)
  const stockM = readCalcNumber("calc-stock-m");
  const finalM = readCalcNumber("calc-final-m");
  const finalVolumeInput = readCalcNumber("calc-final-volume-l");
  const finalVolumeUnit = document.getElementById("calc-final-volume-unit")?.value || "L";
  const finalVolume = convertVolumeToLiter(finalVolumeInput, finalVolumeUnit);

  const stockVolume = stockM && finalM && finalVolume ? (finalM * finalVolume) / stockM : NaN;
  const solventVolume =
    Number.isFinite(stockVolume) && finalVolume !== null
      ? Math.max(finalVolume - stockVolume, 0)
      : NaN;

  setCalcText("calc-result-stock-volume", formatCalcNumber(stockVolume, "L"));
  setCalcText("calc-result-solvent", formatCalcNumber(solventVolume, "L"));
}

// ═══════════════════════════════════════
// 14. LỜI GIẢI TỪNG BƯỚC CHO CALCULATOR
// ═══════════════════════════════════════

function showSolution(id, html) {
  const box = document.getElementById(id);
  if (!box) {
    console.error("Không tìm thấy solution box:", id);
    return;
  }
  box.innerHTML = html;
  box.classList.add("show");
}

function showMoleSolution() {
  const chem = getSelectedCalcChemical();
  if (!chem) {
    alert("Vui lòng chọn hóa chất.");
    return;
  }

  const molarMass = chem.molarMass || Number.parseFloat(chem.molar);
  const massInput = readCalcNumber("calc-mass-g");
  const massUnit = document.getElementById("calc-mass-unit")?.value || "g";
  const mass = convertMassToGram(massInput, massUnit);

  const moles = readCalcNumber("calc-moles");
  const volumeInput = readCalcNumber("calc-volume-l");
  const volumeUnit = document.getElementById("calc-volume-unit")?.value || "L";
  const volume = convertVolumeToLiter(volumeInput, volumeUnit);

  let html = `<div class="solution-header">📘 LỜI GIẢI TỪNG BƯỚC</div>`;

  if (mass === null && moles === null && volume === null) {
    html += `<div class="solution-empty">⚠️ Vui lòng nhập dữ liệu trước khi xem lời giải.</div>`;
    showSolution("mole-solution", html);
    return;
  }

  // Khối lượng -> Mol
  if (mass !== null) {
    const calculatedMoles = mass / molarMass;
    html += `
      <div class="solution-step">
        <div class="solution-step-title">Bước 1 — Dữ kiện</div>
        <div>Hóa chất: <strong>${chem.formula} (${chem.name})</strong></div>
        <div>Khối lượng: <strong>${massInput} ${massUnit} ${massUnit !== "g" ? `(= ${mass} g)` : ""}</strong></div>
        <div>Khối lượng mol: <strong>${molarMass.toFixed(4)} g/mol</strong></div>
      </div>
      <div class="solution-step">
        <div class="solution-step-title">Bước 2 — Công thức</div>
        <div class="solution-formula">n = m / M</div>
      </div>
      <div class="solution-step">
        <div class="solution-step-title">Bước 3 — Thay số</div>
        <div class="solution-formula">n = ${mass} / ${molarMass.toFixed(4)}</div>
      </div>
      <div class="solution-step">
        <div class="solution-step-title">Bước 4 — Kết quả</div>
        <div class="solution-answer">n ≈ ${calculatedMoles.toFixed(6)} mol</div>
      </div>
    `;
  }

  // Mol -> Khối lượng
  if (moles !== null) {
    const calculatedMass = moles * molarMass;
    html += `
      <div class="solution-step">
        <div class="solution-step-title">Tính khối lượng từ số mol</div>
        <div class="solution-formula">m = n × M</div>
        <div class="solution-formula">m = ${moles} × ${molarMass.toFixed(4)}</div>
        <div class="solution-answer">m ≈ ${calculatedMass.toFixed(6)} g</div>
      </div>
    `;
  }

  // Nồng độ mol
  if (volume !== null && volume > 0) {
    const baseMoles = moles !== null ? moles : (mass !== null ? mass / molarMass : null);
    if (baseMoles !== null) {
      const molarity = baseMoles / volume;
      html += `
        <div class="solution-step">
          <div class="solution-step-title">Tính nồng độ mol (M)</div>
          <div class="solution-formula">C = n / V</div>
          <div class="solution-formula">C = ${baseMoles.toFixed(6)} / ${volume}</div>
          <div class="solution-answer">C ≈ ${molarity.toFixed(6)} M</div>
        </div>
      `;
    }
  }

  showSolution("mole-solution", html);
}

function showPreparationSolution() {
  const chem = getSelectedCalcChemical();
  if (!chem) {
    alert("Vui lòng chọn hóa chất.");
    return;
  }

  const molarMass = chem.molarMass || Number.parseFloat(chem.molar);
  const targetM = readCalcNumber("calc-target-m");
  const targetVolumeInput = readCalcNumber("calc-target-volume-l");
  const targetVolumeUnit = document.getElementById("calc-target-volume-unit")?.value || "L";
  const targetVolume = convertVolumeToLiter(targetVolumeInput, targetVolumeUnit);

  let html = `<div class="solution-header">📘 LỜI GIẢI PHA DUNG DỊCH</div>`;

  if (targetM === null || targetVolume === null || targetM <= 0 || targetVolume <= 0) {
    html += `<div class="solution-empty">⚠️ Vui lòng nhập nồng độ và thể tích cần pha.</div>`;
    showSolution("preparation-solution", html);
    return;
  }

  const targetMoles = targetM * targetVolume;
  const gramsNeeded = targetMoles * molarMass;

  html += `
    <div class="solution-step">
      <div class="solution-step-title">Bước 1 — Dữ kiện</div>
      <div>Hóa chất: <strong>${chem.formula} (${chem.name})</strong></div>
      <div>Nồng độ cần pha (C): <strong>${targetM} M</strong></div>
      <div>Thể tích cần pha (V): <strong>${targetVolumeInput} ${targetVolumeUnit} ${targetVolumeUnit !== "L" ? `(= ${targetVolume} L)` : ""}</strong></div>
      <div>Khối lượng mol (M): <strong>${molarMass.toFixed(4)} g/mol</strong></div>
    </div>
    <div class="solution-step">
      <div class="solution-step-title">Bước 2 — Tính số mol</div>
      <div class="solution-formula">n = C × V</div>
      <div class="solution-formula">n = ${targetM} × ${targetVolume}</div>
      <div class="solution-answer">n = ${targetMoles.toFixed(6)} mol</div>
    </div>
    <div class="solution-step">
      <div class="solution-step-title">Bước 3 — Tính khối lượng chất tan cần cân</div>
      <div class="solution-formula">m = n × M</div>
      <div class="solution-formula">m = ${targetMoles.toFixed(6)} × ${molarMass.toFixed(4)}</div>
      <div class="solution-answer">m = ${gramsNeeded.toFixed(6)} g</div>
    </div>
    <div class="solution-step">
      <div class="solution-step-title">Bước 4 — Kết luận & Thao tác</div>
      <div class="solution-answer">
        Cân chính xác <strong>${gramsNeeded.toFixed(4)} g ${chem.formula}</strong>, hòa tan vào một lượng nước cất vừa đủ trong bình định mức, sau đó thêm nước cất đến vạch <strong>${targetVolume} L</strong> và lắc đều.
      </div>
    </div>
  `;

  showSolution("preparation-solution", html);
}

function showDilutionSolution() {
  const stockM = readCalcNumber("calc-stock-m");
  const finalM = readCalcNumber("calc-final-m");
  const finalVolumeInput = readCalcNumber("calc-final-volume-l");
  const finalVolumeUnit = document.getElementById("calc-final-volume-unit")?.value || "L";
  const finalVolume = convertVolumeToLiter(finalVolumeInput, finalVolumeUnit);

  let html = `<div class="solution-header">📘 LỜI GIẢI PHA LOÃNG</div>`;

  if (
    stockM === null ||
    finalM === null ||
    finalVolume === null ||
    stockM <= 0 ||
    finalM <= 0 ||
    finalVolume <= 0
  ) {
    html += `<div class="solution-empty">⚠️ Vui lòng nhập đầy đủ nồng độ gốc C₁, nồng độ mong muốn C₂ và thể tích V₂.</div>`;
    showSolution("dilution-solution", html);
    return;
  }

  const stockVolume = (finalM * finalVolume) / stockM;
  const solventVolume = Math.max(finalVolume - stockVolume, 0);

  html += `
    <div class="solution-step">
      <div class="solution-step-title">Bước 1 — Dữ kiện</div>
      <div>Nồng độ gốc (C₁): <strong>${stockM} M</strong></div>
      <div>Nồng độ cần pha (C₂): <strong>${finalM} M</strong></div>
      <div>Thể tích cần pha (V₂): <strong>${finalVolumeInput} ${finalVolumeUnit} ${finalVolumeUnit !== "L" ? `(= ${finalVolume} L)` : ""}</strong></div>
    </div>
    <div class="solution-step">
      <div class="solution-step-title">Bước 2 — Công thức pha loãng</div>
      <div class="solution-formula">C₁V₁ = C₂V₂</div>
    </div>
    <div class="solution-step">
      <div class="solution-step-title">Bước 3 — Tính thể tích dung dịch gốc cần lấy (V₁)</div>
      <div class="solution-formula">V₁ = (C₂ × V₂) / C₁</div>
      <div class="solution-formula">V₁ = (${finalM} × ${finalVolume}) / ${stockM}</div>
      <div class="solution-answer">V₁ = ${stockVolume.toFixed(6)} L (${(stockVolume * 1000).toFixed(2)} mL)</div>
    </div>
    <div class="solution-step">
      <div class="solution-step-title">Bước 4 — Lượng dung môi cần thêm</div>
      <div class="solution-formula">Vdung môi = V₂ − V₁</div>
      <div class="solution-formula">${finalVolume} − ${stockVolume.toFixed(6)}</div>
      <div class="solution-answer">Vdung môi ≈ ${solventVolume.toFixed(6)} L (${(solventVolume * 1000).toFixed(2)} mL)</div>
    </div>
  `;

  showSolution("dilution-solution", html);
}

// Gắn hàm lời giải vào window
window.showMoleSolution = showMoleSolution;
window.showPreparationSolution = showPreparationSolution;
window.showDilutionSolution = showDilutionSolution;

// ═══════════════════════════════════════
// 15. HỎI AI VỀ CÁC BÀI TOÁN CALCULATOR
// ═══════════════════════════════════════

function getCalculatorChemicalContext() {
  const chem = getSelectedCalcChemical();
  if (!chem) return null;
  const molarMass = chem.molarMass || Number.parseFloat(chem.molar);
  return {
    name: chem.name || chem.formula,
    formula: chem.formula || "",
    molarMass: molarMass
  };
}

function askAIAboutMoleProblem() {
  const chem = getCalculatorChemicalContext();
  if (!chem) {
    alert("Vui lòng chọn hóa chất trước.");
    return;
  }

  const mass = readCalcNumber("calc-mass-g");
  const moles = readCalcNumber("calc-moles");
  const volume = readCalcNumber("calc-volume-l");

  if (mass === null && moles === null && volume === null) {
    alert("Vui lòng nhập dữ liệu Calculator trước.");
    return;
  }

  const calculatedMoles = mass !== null ? mass / chem.molarMass : moles;
  let calculatedMolarity = null;
  if (volume !== null && volume > 0 && calculatedMoles !== null) {
    calculatedMolarity = calculatedMoles / volume;
  }

  const prompt = `
Tôi đang học Hóa học và vừa sử dụng Chemistry Calculator.

Hóa chất:
- Tên: ${chem.name}
- Công thức: ${chem.formula}
- Khối lượng mol: ${chem.molarMass.toFixed(4)} g/mol

Dữ kiện:
- Khối lượng: ${mass !== null ? mass + " g" : "Không nhập"}
- Số mol: ${moles !== null ? moles + " mol" : "Không nhập"}
- Thể tích dung dịch: ${volume !== null ? volume + " L" : "Không nhập"}

Kết quả Calculator:
- Số mol: ${calculatedMoles !== null ? calculatedMoles.toFixed(6) + " mol" : "Không tính được"}
- Nồng độ mol: ${calculatedMolarity !== null ? calculatedMolarity.toFixed(6) + " M" : "Không tính được"}

Hãy giải thích bài toán này cho một học sinh:
1. Giải thích dữ kiện.
2. Giải thích công thức được sử dụng.
3. Giải thích tại sao dùng công thức đó.
4. Kiểm tra kết quả Calculator.
5. Đưa ra mẹo để nhớ công thức.
Dùng tiếng Việt dễ hiểu.
  `;
  sendQuick(prompt);
}

function askAIAboutPreparation() {
  const chem = getCalculatorChemicalContext();
  if (!chem) {
    alert("Vui lòng chọn hóa chất trước.");
    return;
  }

  const targetM = readCalcNumber("calc-target-m");
  const targetVolume = readCalcNumber("calc-target-volume-l");
  if (targetM === null || targetVolume === null) {
    alert("Vui lòng nhập đầy đủ dữ liệu nồng độ và thể tích.");
    return;
  }

  const targetMoles = targetM * targetVolume;
  const gramsNeeded = targetMoles * chem.molarMass;

  const prompt = `
Tôi đang học Hóa học. Tôi cần pha dung dịch:
Hóa chất: ${chem.name} (${chem.formula}), M = ${chem.molarMass.toFixed(4)} g/mol
Nồng độ cần pha: ${targetM} M
Thể tích cần pha: ${targetVolume} L

Calculator tính được:
- Số mol: ${targetMoles.toFixed(6)} mol
- Khối lượng cần cân: ${gramsNeeded.toFixed(6)} g

Hãy giải thích cho học sinh:
1. Tại sao phải tính số mol trước?
2. Công thức n = C × V có ý nghĩa gì?
3. Tại sao m = n × M?
4. Kiểm tra kết quả.
5. Nêu quy trình thao tác an toàn khi pha trong phòng thí nghiệm.
Dùng tiếng Việt dễ hiểu.
  `;
  sendQuick(prompt);
}

function askAIAboutDilution() {
  const stockM = readCalcNumber("calc-stock-m");
  const finalM = readCalcNumber("calc-final-m");
  const finalVolume = readCalcNumber("calc-final-volume-l");

  if (stockM === null || finalM === null || finalVolume === null) {
    alert("Vui lòng nhập đầy đủ dữ liệu C₁, C₂ và V₂.");
    return;
  }

  const stockVolume = (finalM * finalVolume) / stockM;
  const solventVolume = Math.max(finalVolume - stockVolume, 0);

  const prompt = `
Tôi đang học Hóa học và đang giải bài toán pha loãng.
Dữ kiện:
C₁ = ${stockM} M
C₂ = ${finalM} M
V₂ = ${finalVolume} L

Calculator đã tính:
- Công thức: C₁V₁ = C₂V₂
- V₁ = ${stockVolume.toFixed(6)} L
- Lượng dung môi cần thêm ≈ ${solventVolume.toFixed(6)} L

Hãy:
1. Giải thích công thức C₁V₁ = C₂V₂.
2. Giải thích tại sao có thể sử dụng công thức này.
3. Kiểm tra kết quả.
4. Giải thích cách thực hiện pha loãng ngoài thực tế (chú ý an toàn khi pha loãng axit).
5. Nêu một lỗi học sinh thường mắc khi làm dạng bài này.
Dùng tiếng Việt dễ hiểu.
  `;
  sendQuick(prompt);
}

function askAIAboutProblem(type) {
  if (type === "mole") return askAIAboutMoleProblem();
  if (type === "preparation") return askAIAboutPreparation();
  if (type === "dilution") return askAIAboutDilution();
}

// ═══════════════════════════════════════
// 16. TAB CƠ SỞ DỮ LIỆU (DATABASE TAB)
// ═══════════════════════════════════════

let dbGradeView = "group"; // "group" = chia nhóm theo lớp; 6..12 hoặc "nc"

function getAllowedGradeGroups() {
  const nums = currentGrade === "all" ? GRADE_NUMBERS : GRADE_NUMBERS.filter(g => g <= currentGrade);
  return currentGrade === "all" ? [...nums, "nc"] : nums;
}

function renderDBGradeChips() {
  const row = document.getElementById("db-grade-chips");
  if (!row) return;
  const groups = getAllowedGradeGroups();
  if (dbGradeView !== "group" && !groups.includes(dbGradeView)) dbGradeView = "group";
  const chip = (v, label) =>
    `<button class="grade-chip${dbGradeView === v ? " active" : ""}" type="button" onclick="setDbGradeView(${typeof v === "number" ? v : `'${v}'`})">${label}</button>`;
  row.innerHTML =
    chip("group", "Tất cả nhóm") +
    groups.map(g => chip(g, g === "nc" ? "Nâng cao" : `Lớp ${g}`)).join("");
}

function setDbGradeView(v) {
  dbGradeView = v;
  renderDBGradeChips();
  filterDB(document.querySelector(".db-search")?.value || "");
}

function renderDBCard(chem) {
  const dangerColors = {
    danger: { color: "#ff4757", bg: "rgba(255,71,87,0.1)", border: "rgba(255,71,87,0.3)" },
    caution: { color: "#ffa502", bg: "rgba(255,165,2,0.1)", border: "rgba(255,165,2,0.3)" },
    safe: { color: "#2ed573", bg: "rgba(46,213,115,0.1)", border: "rgba(46,213,115,0.3)" }
  };
  const dc = dangerColors[chem.danger] || dangerColors.safe;
  const f = chem.formula.replace(/'/g, "\\'");
  const n = chem.name.replace(/'/g, "\\'");

  const mol3dBtn =
    typeof openMol3DByFormula === "function"
      ? `<button class="mol3d-db-btn" type="button" onclick="event.stopPropagation(); openMol3DByFormula('${f}')">🧬 Xem 3D</button>`
      : "";

  return `
    <div class="db-card" onclick="askAbout('${f}', '${n}')" title="${escapeHtml(formatGradeTopics(chem))}">
      <div class="db-card-grades">${getGradeBadgesHtml(chem)}</div>
      <div class="db-card-formula" style="color:${dc.color}">${escapeHtml(chem.formula)}</div>
      <div class="db-card-name">${escapeHtml(chem.name)}</div>
      <div class="db-card-props">
        <div class="db-prop-row"><span>Khối lượng phân tử</span><span class="db-prop-val">${escapeHtml(chem.molar || "--")}</span></div>
        <div class="db-prop-row"><span>Điểm sôi</span><span class="db-prop-val">${escapeHtml(chem.boiling || "--")}</span></div>
        <div class="db-prop-row"><span>pH (dd)</span><span class="db-prop-val">${escapeHtml(chem.ph || "--")}</span></div>
      </div>
      <span class="db-danger-badge" style="background:${dc.bg};color:${dc.color};border:1px solid ${dc.border}">
        ${escapeHtml(chem.dangerLabel || "AN TOÀN")}
      </span>
      <div style="margin-top:8px;font-size:11px;color:var(--text-dim)">Nhấn để hỏi AI →</div>
      ${mol3dBtn}
    </div>`;
}

function renderDB(data) {
  const grid = document.getElementById("db-grid");
  if (!grid) return;
  const groups = dbGradeView === "group" ? getAllowedGradeGroups() : [dbGradeView];

  const html = groups
    .map(g => {
      const seen = new Set();
      const items = data
        .filter(c => (g === "nc" ? c.isAdvanced : (c.grades || []).includes(g)))
        .filter(c => !seen.has(c.formula) && seen.add(c.formula));

      if (!items.length) return "";
      const title =
        g === "nc"
          ? `Nâng cao <small>· ngoài chương trình phổ thông / phòng thí nghiệm</small>`
          : `Lớp ${g} <small>· ${getGradeSubject(g)}</small>`;

      return `
        <section class="db-grade-group">
          <h2 class="db-grade-title">${title}<span class="db-grade-count">${items.length} chất</span></h2>
          <div class="db-grade-cards">${items.map(renderDBCard).join("")}</div>
        </section>`;
    })
    .join("");

  grid.innerHTML =
    html || `<div class="chemical-no-result">Không có hóa chất phù hợp trong phạm vi ${getGradeLabel()}.</div>`;
}

function filterDB(query) {
  if (typeof CHEM_DATABASE === "undefined") return;
  const q = normalizeText(query);
  const compact = compactFormula(query);

  const filtered = CHEM_DATABASE.filter(c => {
    const searchableText = normalizeText(
      [c.formula, c.name, c.properties, c.msds, ...(c.aliases || [])].join(" ")
    );
    const searchableFormula = compactFormula(c.formula);
    return searchableText.includes(q) || (compact && searchableFormula.includes(compact));
  });
  renderDB(filtered);
}

function askAbout(formula, name) {
  const chatBtn = document.querySelector('[data-tab="chat"]');
  if (chatBtn) switchTab("chat", chatBtn);

  const input = document.getElementById("chat-input");
  if (!input) return;
  input.value = `Cho tôi biết thông tin đầy đủ về ${formula} (${name}): tính chất, mức độ nguy hiểm, cách lưu trữ và PPE cần thiết.`;
  sendMessage();
}

// ═══════════════════════════════════════
// 17. ĐIỀU HƯỚNG GIAO DIỆN & KHỞI TẠO
// ═══════════════════════════════════════

function switchTab(tabId, btn) {
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));

  const targetPanel = document.getElementById("tab-" + tabId);
  if (targetPanel) targetPanel.classList.add("active");
  if (btn) btn.classList.add("active");
}

function autoResize(el) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 160) + "px";
}

function handleKey(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function showLoading(show) {
  const el = document.getElementById("loading");
  if (el) el.classList.toggle("visible", show);
}

function updateDataStatus() {
  const statusText = document.getElementById("api-status-text");
  const apiNote = document.getElementById("api-note");
  if (statusText) statusText.textContent = "Dữ liệu Local đang hoạt động";
  if (apiNote) apiNote.textContent = "";
}

// Đóng dropdown tìm kiếm hóa chất khi click bên ngoài
document.addEventListener("click", e => {
  if (!e.target.closest(".chemical-search-wrap")) {
    document.getElementById("calc-chemical-results")?.classList.remove("show");
  }
});

// Khởi chạy khi DOM sẵn sàng
document.addEventListener("DOMContentLoaded", () => {
  renderMixOptions();
  renderCommonWarnings();
  renderDBGradeChips();
  if (typeof CHEM_DATABASE !== "undefined") {
    renderDB(CHEM_DATABASE);
  }
  renderCalcOptions();
  renderQuickChips();
  updateGradeUI();
  updateDataStatus();

  const prevDate = document.getElementById("qr-prev-date");
  if (prevDate) prevDate.textContent = new Date().toLocaleDateString("vi-VN");

  setTimeout(() => {
    appendMessage("bot", getStartupNotice());
  }, 400);
});
