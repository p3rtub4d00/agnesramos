(() => {
  const $ = s => document.querySelector(s);
  let allItems = [];
  let totals = {};
  const loginCard = $("#login-card");
  const dashboard = $("#dashboard");
  function notice(el, text, error = false) {
    el.textContent = text;
    el.className = "notice " + (text ? (error ? "error" : "success") : "");
  }
  async function api(url, options = {}) {
    const response = await fetch(url, { ...options, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) { showLogin(); throw new Error(data.error || "Faça login novamente."); }
    if (!response.ok) throw new Error(data.error || "Não foi possível concluir a operação.");
    return data;
  }
  function showLogin() { loginCard.hidden = false; dashboard.hidden = true; }
  function showDashboard() { loginCard.hidden = true; dashboard.hidden = false; }
  $("#login-form").addEventListener("submit", async e => {
    e.preventDefault();
    const button = e.currentTarget.querySelector("button");
    button.disabled = true;
    notice($("#login-message"), "");
    try {
      await api("/api/admin/login", { method: "POST", body: JSON.stringify({ password: $("#admin-password").value }) });
      $("#admin-password").value = "";
      showDashboard();
      await Promise.all([loadItems(), loadSettings()]);
    } catch (err) { notice($("#login-message"), err.message, true); }
    finally { button.disabled = false; }
  });
  function render() {
    const q = $("#search-input").value.trim().toLocaleLowerCase("pt-BR");
    const status = $("#status-filter").value;
    const rows = $("#rsvp-rows");
    rows.replaceChildren();
    const filtered = allItems.filter(item => {
      const searchable = [item.responsible, item.phone, ...(item.guests || []).map(g => g.name)].join(" ").toLocaleLowerCase("pt-BR");
      return searchable.includes(q) && (status === "all" || item.status === status);
    });
    if (!filtered.length) {
      const tr = document.createElement("tr"); const td = document.createElement("td");
      td.colSpan = 5; td.className = "empty-cell"; td.textContent = allItems.length ? "Nenhum resultado para esse filtro." : "Ainda não há confirmações registradas.";
      tr.append(td); rows.append(tr); return;
    }
    filtered.forEach(item => {
      const tr = document.createElement("tr");
      const people = document.createElement("td"); people.className = "people-cell";
      const name = document.createElement("strong"); name.textContent = item.responsible; people.append(name);
      const guestNames = document.createElement("div"); guestNames.className = "guest-names";
      if (item.status === "confirmed") {
        (item.guests || []).forEach(g => {
          const line = document.createElement("div"); line.className = "guest-line";
          const label = document.createElement("span"); label.textContent = (g.isResponsible ? "Responsável: " : "") + g.name + (g.checkedIn ? " ✓" : "");
          const remove = document.createElement("button"); remove.className = "small-action danger-action"; remove.type = "button"; remove.textContent = "Excluir";
          remove.addEventListener("click", async () => {
            const message = g.isResponsible ? "Excluir o responsável também excluirá toda esta confirmação e seus acompanhantes. Continuar?" : "Excluir " + g.name + " da lista de convidados?";
            if (!confirm(message)) return;
            remove.disabled = true;
            try { await api("/api/admin/rsvps/" + encodeURIComponent(item.id) + "/guests/" + encodeURIComponent(g.id), { method: "DELETE" }); await loadItems(); }
            catch (err) { notice($("#list-message"), err.message, true); remove.disabled = false; }
          });
          line.append(label, remove); guestNames.append(line);
        });
      } else guestNames.textContent = "Sem presença confirmada";
      people.append(guestNames);
      const contact = document.createElement("td"); contact.textContent = item.phone || "—";
      const quantity = document.createElement("td"); quantity.textContent = item.status === "confirmed" ? String((item.guests || []).length) : "—";
      const statusCell = document.createElement("td"); const badge = document.createElement("span");
      badge.className = "status-badge " + item.status; badge.textContent = item.status === "confirmed" ? "Confirmado" : "Não irá"; statusCell.append(badge);
      const action = document.createElement("td");
      const toggle = document.createElement("button"); toggle.className = "small-action";
      toggle.textContent = "Marcar como não irá";
      if (item.status === "declined") { action.textContent = "Aguardando nova resposta"; tr.append(people, contact, quantity, statusCell, action); rows.append(tr); return; }
      toggle.addEventListener("click", async () => {
        if (!confirm("Deseja alterar o status desta confirmação?")) return;
        toggle.disabled = true;
        try { await api("/api/admin/rsvps/" + encodeURIComponent(item.id), { method: "PATCH", body: JSON.stringify({ status: item.status === "confirmed" ? "declined" : "confirmed" }) }); await loadItems(); }
        catch (err) { notice($("#list-message"), err.message, true); }
        finally { toggle.disabled = false; }
      });
      action.append(toggle); tr.append(people, contact, quantity, statusCell, action); rows.append(tr);
    });
  }
  async function loadSettings() {
    notice($("#settings-message"), "Carregando informações do local...");
    try {
      const data = await api("/api/admin/settings");
      $("#event-name-input").value = data.eventName || "Helena";
      $("#event-venue-input").value = data.venue || "";
      $("#event-address-input").value = data.address || "";
      $("#event-map-input").value = data.mapUrl || "";
      notice($("#settings-message"), "");
    } catch (err) { notice($("#settings-message"), err.message, true); }
  }
  $("#event-settings-form").addEventListener("submit", async e => {
    e.preventDefault();
    const button = e.currentTarget.querySelector("button");
    button.disabled = true;
    notice($("#settings-message"), "Salvando...");
    try {
      await api("/api/admin/settings", { method: "PUT", body: JSON.stringify({ eventName: $("#event-name-input").value, venue: $("#event-venue-input").value, address: $("#event-address-input").value, mapUrl: $("#event-map-input").value }) });
      notice($("#settings-message"), "Nome, local e endereço salvos. O convite público já está atualizado.");
    } catch (err) { notice($("#settings-message"), err.message, true); }
    finally { button.disabled = false; }
  });
  async function loadItems() {
    notice($("#list-message"), "Carregando lista...");
    try {
      const data = await api("/api/admin/rsvps");
      allItems = data.items || []; totals = data.totals || {};
      $("#total-families").textContent = totals.families || 0;
      $("#total-people").textContent = totals.people || 0;
      $("#total-checkin").textContent = totals.checkedIn || 0;
      $("#total-declined").textContent = totals.pending || 0;
      notice($("#list-message"), "");
      render();
    } catch (err) { notice($("#list-message"), err.message, true); }
  }
  $("#search-input").addEventListener("input", render);
  $("#status-filter").addEventListener("change", render);
  $("#refresh-btn").addEventListener("click", loadItems);
  $("#logout-btn").addEventListener("click", async () => { await fetch("/api/logout", { method: "POST" }); showLogin(); });
  $("#print-btn").addEventListener("click", () => window.print());
  $("#export-btn").addEventListener("click", () => {
    const rows = [["Responsável", "Telefone", "Status", "Convidado", "Entrada registrada", "Observações"]];
    allItems.forEach(item => {
      if (item.status === "declined" || !item.guests.length) rows.push([item.responsible, item.phone, item.status === "confirmed" ? "Confirmado" : "Não irá", "", "", item.notes]);
      else item.guests.forEach(g => rows.push([item.responsible, item.phone, "Confirmado", g.name, g.checkedIn ? "Sim" : "Não", item.notes]));
    });
    const csv = "\ufeff" + rows.map(row => row.map(v => '"' + String(v ?? "").replace(/"/g, '""') + '"').join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a"); a.href = url; a.download = "lista-convidados-agnes.csv"; a.click(); URL.revokeObjectURL(url);
  });
  // A sessão é validada ao carregar a lista. O formulário de login aparece por padrão.
})();
