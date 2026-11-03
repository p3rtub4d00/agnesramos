(() => {
  const $ = s => document.querySelector(s);
  const login = $("#gate-login");
  const dashboard = $("#gate-dashboard");
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
  $("#gate-search-btn").addEventListener("click", search);
  $("#gate-search").addEventListener("keydown", e => { if (e.key === "Enter") search(); });
  $("#gate-search").addEventListener("input", () => { if ($("#gate-search").value.trim().length === 0) search(); });
  $("#gate-logout").addEventListener("click", async () => { await fetch("/api/logout", { method: "POST" }); dashboard.hidden = true; login.hidden = false; });
})();