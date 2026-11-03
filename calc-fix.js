(function () {
  function normalizeCalcMass(raw, unit) {
    if (raw === null || raw === undefined || !Number.isFinite(raw)) return null;
    const normalizedUnit = unit || "g";
    switch (normalizedUnit) {
      case "mg": return raw / 1000;
      case "kg": return raw * 1000;
      case "g":
      default: return raw;
    }
  }

  function normalizeCalcVolume(raw, unit) {
    if (raw === null || raw === undefined || !Number.isFinite(raw)) return null;
    const normalizedUnit = unit || "L";
    switch (normalizedUnit) {
      case "mL": return raw / 1000;
      case "L":
      default: return raw;
    }
  }

  function readValidatedNumber(id) {
    const raw = document.getElementById(id)?.value;
    if (raw === undefined || raw === null || String(raw).trim() === "") return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  function ensureValidDilutionState() {
    const stockM = readValidatedNumber("calc-stock-m");
    const finalM = readValidatedNumber("calc-final-m");
    const finalVolumeInput = readValidatedNumber("calc-final-volume-l");
    const finalVolumeUnit = document.getElementById("calc-final-volume-unit")?.value || "L";
    const finalVolume = normalizeCalcVolume(finalVolumeInput, finalVolumeUnit);

    const valid = stockM !== null && stockM > 0 && finalM !== null && finalM > 0 && finalVolume !== null && finalVolume > 0;

    if (!valid) {
      return { valid: false, stockM, finalM, finalVolume };
    }
    return { valid: true, stockM, finalM, finalVolume };
  }

  function updateCalc() {
    const chem = typeof getSelectedCalcChemical === "function" ? getSelectedCalcChemical() : null;
    if (!chem) return;

    const molarMass = chem.molarMass || Number.parseFloat(chem.molar);
    if (typeof setCalcText === "function") {
      setCalcText("calc-formula", chem.formula);
      setCalcText("calc-name", chem.name);
      setCalcText("calc-molar-mass", formatCalcNumber(molarMass, "g/mol"));
      setCalcText("calc-danger", chem.dangerLabel);
      setCalcText("calc-ph", chem.ph);
    }

    const massInput = readValidatedNumber("calc-mass-g");
    const massUnit = document.getElementById("calc-mass-unit")?.value || "g";
    const moles = readValidatedNumber("calc-moles");
    const volumeInput = readValidatedNumber("calc-volume-l");
    const volumeUnit = document.getElementById("calc-volume-unit")?.value || "L";

    const mass = normalizeCalcMass(massInput, massUnit);
    const volume = normalizeCalcVolume(volumeInput, volumeUnit);

    const molesFromMass = mass !== null && molarMass > 0 ? mass / molarMass : NaN;
    const massFromMoles = moles !== null ? moles * molarMass : NaN;
    const baseMoles = moles !== null ? moles : (Number.isFinite(molesFromMass) ? molesFromMass : NaN);
    const molarity = Number.isFinite(baseMoles) && volume !== null && volume > 0 ? baseMoles / volume : NaN;

    if (typeof setCalcText === "function") {
      setCalcText("calc-result-moles", formatCalcNumber(molesFromMass, "mol"));
      setCalcText("calc-result-mass", formatCalcNumber(massFromMoles, "g"));
      setCalcText("calc-result-molarity", formatCalcNumber(molarity, "M"));
    }

    const targetM = readValidatedNumber("calc-target-m");
    const targetVolumeInput = readValidatedNumber("calc-target-volume-l");
    const targetVolumeUnit = document.getElementById("calc-target-volume-unit")?.value || "L";
    const targetVolume = normalizeCalcVolume(targetVolumeInput, targetVolumeUnit);

    const targetMoles = Number.isFinite(targetM) && Number.isFinite(targetVolume) && targetM > 0 && targetVolume > 0 ? targetM * targetVolume : NaN;
    const gramsNeeded = Number.isFinite(targetMoles) ? targetMoles * molarMass : NaN;

    if (typeof setCalcText === "function") {
      setCalcText("calc-result-target-moles", formatCalcNumber(targetMoles, "mol"));
      setCalcText("calc-result-grams-needed", formatCalcNumber(gramsNeeded, "g"));
    }

    const dilutionState = ensureValidDilutionState();
    if (!dilutionState.valid) {
      if (typeof setCalcText === "function") {
        setCalcText("calc-result-stock-volume", "Không khả thi");
        setCalcText("calc-result-solvent", "—");
      }
      return;
    }

    const stockM = dilutionState.stockM;
    const finalM = dilutionState.finalM;
    const finalVolume = dilutionState.finalVolume;

    if (finalM > stockM) {
      if (typeof setCalcText === "function") {
        setCalcText("calc-result-stock-volume", "Không khả thi");
        setCalcText("calc-result-solvent", "C₂ > C₁");
      }
      return;
    }

    const stockVolume = (finalM * finalVolume) / stockM;
    const solventVolume = Math.max(finalVolume - stockVolume, 0);

    if (typeof setCalcText === "function") {
      setCalcText("calc-result-stock-volume", formatCalcNumber(stockVolume, "L"));
      setCalcText("calc-result-solvent", formatCalcNumber(solventVolume, "L"));
    }
  }

  function showDilutionSolution() {
    const stockM = readValidatedNumber("calc-stock-m");
    const finalM = readValidatedNumber("calc-final-m");
    const finalVolumeInput = readValidatedNumber("calc-final-volume-l");
    const finalVolumeUnit = document.getElementById("calc-final-volume-unit")?.value || "L";
    const finalVolume = normalizeCalcVolume(finalVolumeInput, finalVolumeUnit);

    let html = '<div class="solution-header">📘 LỜI GIẢI PHA LOÃNG</div>';

    if (
      stockM === null ||
      finalM === null ||
      finalVolume === null ||
      stockM <= 0 ||
      finalM <= 0 ||
      finalVolume <= 0
    ) {
      html += '<div class="solution-empty">⚠️ Vui lòng nhập đầy đủ nồng độ gốc C₁, nồng độ mong muốn C₂ và thể tích V₂.</div>';
      if (typeof showSolution === "function") showSolution("dilution-solution", html);
      return;
    }

    if (finalM > stockM) {
      html += '<div class="solution-empty">⚠️ Không thể pha loãng: nồng độ đích C₂ lớn hơn nồng độ gốc C₁. Hãy kiểm tra lại dữ kiện bài toán.</div>';
      if (typeof showSolution === "function") showSolution("dilution-solution", html);
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

    if (typeof showSolution === "function") showSolution("dilution-solution", html);
  }

  function askAIAboutMoleProblem() {
    const chem = typeof getCalculatorChemicalContext === "function" ? getCalculatorChemicalContext() : null;
    if (!chem) {
      alert("Vui lòng chọn hóa chất trước.");
      return;
    }

    const massRaw = readValidatedNumber("calc-mass-g");
    const massUnit = document.getElementById("calc-mass-unit")?.value || "g";
    const mass = normalizeCalcMass(massRaw, massUnit);

    const moles = readValidatedNumber("calc-moles");
    const volumeRaw = readValidatedNumber("calc-volume-l");
    const volumeUnit = document.getElementById("calc-volume-unit")?.value || "L";
    const volume = normalizeCalcVolume(volumeRaw, volumeUnit);

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
- Khối lượng: ${mass !== null ? mass.toFixed(6) + " g" : "Không nhập"}
- Số mol: ${moles !== null ? moles.toFixed(6) + " mol" : "Không nhập"}
- Thể tích dung dịch: ${volume !== null ? volume.toFixed(6) + " L" : "Không nhập"}

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
    if (typeof sendQuick === "function") sendQuick(prompt);
  }

  function askAIAboutPreparation() {
    const chem = typeof getCalculatorChemicalContext === "function" ? getCalculatorChemicalContext() : null;
    if (!chem) {
      alert("Vui lòng chọn hóa chất trước.");
      return;
    }

    const targetM = readValidatedNumber("calc-target-m");
    const targetVolumeRaw = readValidatedNumber("calc-target-volume-l");
    const targetVolumeUnit = document.getElementById("calc-target-volume-unit")?.value || "L";
    const targetVolume = normalizeCalcVolume(targetVolumeRaw, targetVolumeUnit);

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
Thể tích cần pha: ${targetVolume.toFixed(6)} L

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
    if (typeof sendQuick === "function") sendQuick(prompt);
  }

  function askAIAboutDilution() {
    const stockM = readValidatedNumber("calc-stock-m");
    const finalM = readValidatedNumber("calc-final-m");
    const finalVolumeRaw = readValidatedNumber("calc-final-volume-l");
    const finalVolumeUnit = document.getElementById("calc-final-volume-unit")?.value || "L";
    const finalVolume = normalizeCalcVolume(finalVolumeRaw, finalVolumeUnit);

    if (stockM === null || finalM === null || finalVolume === null) {
      alert("Vui lòng nhập đầy đủ dữ liệu C₁, C₂ và V₂.");
      return;
    }

    if (stockM <= 0 || finalM <= 0 || finalVolume <= 0) {
      alert("C₁, C₂ và V₂ phải lớn hơn 0.");
      return;
    }

    if (finalM > stockM) {
      alert("Không thể pha loãng vì nồng độ đích C₂ lớn hơn nồng độ gốc C₁.");
      return;
    }

    const stockVolume = (finalM * finalVolume) / stockM;
    const solventVolume = Math.max(finalVolume - stockVolume, 0);

    const prompt = `
Tôi đang học Hóa học và đang giải bài toán pha loãng.
Dữ kiện:
C₁ = ${stockM} M
C₂ = ${finalM} M
V₂ = ${finalVolume.toFixed(6)} L

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
    if (typeof sendQuick === "function") sendQuick(prompt);
  }

  window.updateCalc = updateCalc;
  window.showDilutionSolution = showDilutionSolution;
  window.askAIAboutMoleProblem = askAIAboutMoleProblem;
  window.askAIAboutPreparation = askAIAboutPreparation;
  window.askAIAboutDilution = askAIAboutDilution;
})();
