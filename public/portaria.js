(() => {
  const $ = s => document.querySelector(s);
  const login = $("#gate-login");
  const dashboard = $("#gate-dashboard");
  let qrScanner = null;
  let scanning = false;
  function notice(text, error = false) {
    const el = $("#gate-message"); el.textContent = text; el.className = "notice " + (text ? (error ? "error" : "success") : "");
  }
  async function api(url, options = {}) {
    const response = await fetch(url, { ...options, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Não foi possível concluir a operação.");
    return data;
  }
  $("#gate-login-form").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = e.currentTarget.querySelector("button"); btn.disabled = true;
    $("#gate-login-message").textContent = "";
    try {
      await api("/api/portaria/login", { method: "POST", body: JSON.stringify({ password: $("#gate-password").value }) });
      $("#gate-password").value = ""; login.hidden = true; dashboard.hidden = false; await search();
    } catch (err) { $("#gate-login-message").textContent = err.message; $("#gate-login-message").className = "notice error"; }
    finally { btn.disabled = false; }
  });
  async function search() {
    const q = $("#gate-search").value.trim();
    const results = $("#gate-results"); results.replaceChildren(); notice("Consultando lista...");
    try {
      const data = await api("/api/portaria/guests?q=" + encodeURIComponent(q));
      notice("");
      if (!data.items.length) { notice(q ? "Nenhum convidado encontrado com esse nome." : "Nenhum convidado confirmado cadastrado.", true); return; }
      data.items.forEach(item => {
        const card = document.createElement("article"); card.className = "guest-result " + (item.checkedIn ? "already-in" : "");
        const info = document.createElement("div"); info.className = "guest-result-info";
        const name = document.createElement("strong"); name.textContent = item.name;
        const detail = document.createElement("span"); detail.textContent = "Responsável: " + item.responsible + " · Grupo com " + item.total + " pessoa(s)";
        const status = document.createElement("span"); status.className = "check-status"; status.textContent = item.checkedIn ? "✓ Entrada registrada" : "● Aguardando entrada";
        info.append(name, detail, status);
        const btn = document.createElement("button"); btn.className = "checkin-btn"; btn.textContent = item.checkedIn ? "Já entrou" : "Registrar entrada"; btn.disabled = item.checkedIn;
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          try {
            const result = await api("/api/portaria/checkin", { method: "POST", body: JSON.stringify({ id: item.id, guestId: item.guestId }) });
            notice(result.message); await search();
          } catch (err) { notice(err.message, true); btn.disabled = false; }
        });
        card.append(info, btn); results.append(card);
      });
    } catch (err) {
      if (err.message.includes("autorizado") || err.message.includes("novamente")) { login.hidden = false; dashboard.hidden = true; }
      notice(err.message, true);
    }
  }
  async function processTicket(ticketToken) {
    const resultBox = $("#qr-scan-result");
    resultBox.textContent = "Validando comprovante..."; resultBox.className = "qr-scan-result";
    try {
      const result = await api("/api/portaria/checkin-ticket", { method: "POST", body: JSON.stringify({ ticketToken }) });
      resultBox.textContent = result.message + " Pessoas: " + (result.names || []).join(", ");
      resultBox.className = "qr-scan-result success";
      await search();
    } catch (err) {
      resultBox.textContent = err.message;
      resultBox.className = "qr-scan-result error";
    }
  }
  async function stopScanner() {
    if (qrScanner && scanning) { try { await qrScanner.stop(); } catch {} scanning = false; }
    $("#qr-reader").hidden = true; $("#stop-qr-scan").hidden = true; $("#start-qr-scan").hidden = false;
  }
  $("#start-qr-scan").addEventListener("click", async () => {
    if (!window.Html5Qrcode) { $("#qr-scan-result").textContent = "Leitor de QR Code indisponível. Atualize a página."; return; }
    try {
      $("#qr-reader").hidden = false; $("#start-qr-scan").hidden = true; $("#stop-qr-scan").hidden = false;
      qrScanner = new Html5Qrcode("qr-reader");
      await qrScanner.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 230, height: 230 } }, async decodedText => {
        await stopScanner();
        await processTicket(decodedText.trim());
      });
      scanning = true;
      $("#qr-scan-result").textContent = "Aponte a câmera para o QR Code do comprovante.";
    } catch (err) {
      $("#qr-scan-result").textContent = "Não foi possível abrir a câmera. Verifique a permissão do navegador e tente novamente.";
      $("#qr-scan-result").className = "qr-scan-result error";
      await stopScanner();
    }
  });
  $("#stop-qr-scan").addEventListener("click", stopScanner);
  $("#gate-search-btn").addEventListener("click", search);
  $("#gate-search").addEventListener("keydown", e => { if (e.key === "Enter") search(); });
  $("#gate-search").addEventListener("input", () => { if ($("#gate-search").value.trim().length === 0) search(); });
  $("#gate-logout").addEventListener("click", async () => { await stopScanner(); await fetch("/api/logout", { method: "POST" }); dashboard.hidden = true; login.hidden = false; });
})();