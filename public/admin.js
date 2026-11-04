(() => {
  const $ = s => document.querySelector(s);
  let allItems = [];
  let totals = {};
  let activeTicket = null;
  const loginCard = $("#login-card");
  const dashboard = $("#dashboard");
  function notice(el, text, error = false) {
    el.textContent = text;
    el.className = "notice " + (text ? (error ? "error" : "success") : "");
  }
  async function api(url, options = {}) {
    const response = await fetch(url, { credentials: "same-origin", ...options, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) } });
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
      if (!item.responsibleExcluded) { const name = document.createElement("strong"); name.textContent = item.responsible; people.append(name); }
      const guestNames = document.createElement("div"); guestNames.className = "guest-names";
      if (item.status === "confirmed") {
        (item.guests || []).forEach(g => {
          const line = document.createElement("div"); line.className = "guest-line";
          const label = document.createElement("span"); label.textContent = (g.isResponsible ? "Responsável: " : "") + g.name + (g.checkedIn ? " ✓" : "");
          const remove = document.createElement("button"); remove.className = "small-action danger-action"; remove.type = "button"; remove.textContent = "Excluir";
          remove.addEventListener("click", async () => {
            const message = "Excluir " + (g.isResponsible ? "o responsável " : "") + g.name + " da lista de convidados?";
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
      const ticketButton = document.createElement("button");
      ticketButton.className = "small-action ticket-action";
      ticketButton.type = "button";
      ticketButton.textContent = "Ver / enviar QR";
      ticketButton.addEventListener("click", async () => {
        ticketButton.disabled = true;
        try { await openTicket(item); }
        catch (err) { notice($("#list-message"), err.message, true); }
        finally { ticketButton.disabled = false; }
      });
      action.append(ticketButton);
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
  function ticketCanvas() { return $("#admin-ticket-qr").querySelector("canvas"); }
  async function openTicket(item) {
    const data = await api("/api/admin/rsvps/" + encodeURIComponent(item.id) + "/ticket");
    activeTicket = data;
    const target = $("#admin-ticket-qr");
    target.replaceChildren();
    $("#ticket-modal-responsible").textContent = data.responsible;
    $("#ticket-modal-names").textContent = (data.names || []).join(" · ");
    $("#ticket-modal-status").textContent = data.used ? "Este comprovante já foi utilizado na portaria." : "Comprovante válido · apresente este QR Code na entrada.";
    notice($("#ticket-modal-message"), "");
    if (!window.QRCode) throw new Error("O gerador de QR Code não carregou. Atualize a página e tente novamente.");
    new QRCode(target, { text: data.ticketToken, width: 240, height: 240, correctLevel: QRCode.CorrectLevel.M });
    $("#ticket-modal").hidden = false;
  }
  function downloadTicket() {
    const canvas = ticketCanvas();
    if (!canvas || !activeTicket) throw new Error("O QR Code ainda não está pronto.");
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = "comprovante-" + (activeTicket.responsible || "convidado").normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").replace(/[^a-z0-9]+/gi, "-").toLowerCase() + ".png";
    link.click();
  }
  $("#ticket-modal-close").addEventListener("click", () => { $("#ticket-modal").hidden = true; });
  $("#ticket-modal").addEventListener("click", e => { if (e.target === $("#ticket-modal")) $("#ticket-modal").hidden = true; });
  $("#ticket-download-btn").addEventListener("click", () => {
    try { downloadTicket(); notice($("#ticket-modal-message"), "QR Code baixado. Você já pode anexar a imagem no WhatsApp."); }
    catch (err) { notice($("#ticket-modal-message"), err.message, true); }
  });
  $("#ticket-share-btn").addEventListener("click", async () => {
    const button = $("#ticket-share-btn");
    button.disabled = true;
    try {
      const canvas = ticketCanvas();
      if (!canvas || !activeTicket) throw new Error("O QR Code ainda não está pronto.");
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Não foi possível preparar a imagem do comprovante.");
      const file = new File([blob], "comprovante-agnes.png", { type: "image/png" });
      const shareData = { files: [file], title: "Comprovante de entrada", text: "Comprovante de entrada da família " + activeTicket.responsible + " · Aniversário da Agnes." };
      if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
        await navigator.share(shareData);
        notice($("#ticket-modal-message"), "Compartilhamento aberto.");
      } else {
        downloadTicket();
        const phone = String(activeTicket.phone || "").replace(/\\D/g, "");
        const message = "Olá! Segue o comprovante QR Code da confirmação de " + activeTicket.responsible + " para apresentar na portaria. Anexe a imagem baixada.";
        window.open("https://wa.me/" + phone + "?text=" + encodeURIComponent(message), "_blank", "noopener,noreferrer");
        notice($("#ticket-modal-message"), "A imagem foi baixada. Anexe o arquivo PNG no WhatsApp que acabou de abrir.");
      }
    } catch (err) {
      if (err.name !== "AbortError") notice($("#ticket-modal-message"), err.message || "Não foi possível compartilhar o comprovante.", true);
    } finally { button.disabled = false; }
  });
  async function loadSettings() {
    notice($("#settings-message"), "Carregando informações do local...");
    try {
      const data = await api("/api/admin/settings");
      $("#event-name-input").value = data.eventName || "Helena";
      $("#event-venue-input").value = data.venue || "";
      $("#event-address-input").value = data.address || "";
      $("#event-map-input").value = data.mapUrl || "";
      $("#event-date-input").value = /^\d{4}-\d{2}-\d{2}$/.test(data.date || "") ? data.date : "";
      $("#event-time-input").value = data.time || "";
      notice($("#settings-message"), "");
    } catch (err) { notice($("#settings-message"), err.message, true); }
  }
  $("#event-settings-form").addEventListener("submit", async e => {
    e.preventDefault();
    const button = e.currentTarget.querySelector("button");
    button.disabled = true;
    notice($("#settings-message"), "Salvando...");
    try {
      await api("/api/admin/settings", { method: "PUT", body: JSON.stringify({ eventName: $("#event-name-input").value, venue: $("#event-venue-input").value, address: $("#event-address-input").value, mapUrl: $("#event-map-input").value, date: $("#event-date-input").value, time: $("#event-time-input").value }) });
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
  $("#clear-all-btn").addEventListener("click", async () => {
    if (!allItems.length) {
      notice($("#list-message"), "A lista já está vazia.");
      return;
    }
    const confirmation = window.prompt("ATENÇÃO: isso apagará TODAS as confirmações, convidados e registros de entrada. As informações da festa (nome, data, horário e local) serão mantidas. Para confirmar, digite ZERAR:");
    if (confirmation !== "ZERAR") {
      if (confirmation !== null) notice($("#list-message"), "Operação cancelada. Nada foi apagado.");
      return;
    }
    const button = $("#clear-all-btn");
    button.disabled = true;
    notice($("#list-message"), "Apagando todas as confirmações...");
    try {
      const result = await api("/api/admin/rsvps", { method: "DELETE", body: JSON.stringify({ confirmation: "ZERAR" }) });
      await loadItems();
      notice($("#list-message"), result.deletedCount + " confirmação(ões) apagada(s). A lista está zerada.");
    } catch (err) {
      notice($("#list-message"), err.message, true);
    } finally {
      button.disabled = false;
    }
  });
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
  const settingsDetails = document.querySelector(".settings-details");
  if (window.matchMedia("(max-width: 750px)").matches && settingsDetails) settingsDetails.open = false;
  $("#generate-invite-btn").addEventListener("click", async () => {
    const button = $("#generate-invite-btn"); button.disabled = true;
    notice($("#invite-link-message"), "Gerando link seguro...");
    try {
      const data = await api("/api/admin/invitation-links", { method: "POST", body: JSON.stringify({}) });
      $("#generated-invite-url").value = data.url;
      $("#invite-link-result").hidden = false;
      $("#share-whatsapp-btn").hidden = false;
      $("#invite-link-expiry").textContent = "Válido até " + new Date(data.expiresAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) + " · uso único: será invalidado após a primeira resposta.";
      notice($("#invite-link-message"), "Link criado. Envie somente à pessoa convidada.");
    } catch (err) { notice($("#invite-link-message"), err.message, true); }
    finally { button.disabled = false; }
  });
  $("#copy-invite-btn").addEventListener("click", async () => {
    const value = $("#generated-invite-url").value;
    try { await navigator.clipboard.writeText(value); notice($("#invite-link-message"), "Link copiado. Já pode enviar pelo WhatsApp."); }
    catch { $("#generated-invite-url").select(); notice($("#invite-link-message"), "Selecione e copie o link manualmente.", true); }
  });

  $("#share-whatsapp-btn").addEventListener("click", () => {
    const link = $("#generated-invite-url").value.trim();
    if (!link) { notice($("#invite-link-message"), "Gere um link antes de compartilhar.", true); return; }
    const message = "Olá! Você recebeu um convite especial para o aniversário da Agnes! 🎉\n\nConfirme sua presença pelo link pessoal abaixo:\n" + link + "\n\nAtenção: este link é válido por 30 minutos e só pode ser utilizado uma vez.";
    window.open("https://wa.me/?text=" + encodeURIComponent(message), "_blank", "noopener,noreferrer");
  });

  async function refreshPasskeyAvailability() {
    try { const response = await fetch("/api/webauthn/available?role=admin"); const data = await response.json(); $("#passkey-login-btn").hidden = !data.available; }
    catch { $("#passkey-login-btn").hidden = true; }
  }
  $("#register-passkey-btn").addEventListener("click", async () => {
    const button = $("#register-passkey-btn");
    if (!window.isSecureContext || !window.PublicKeyCredential || !navigator.credentials) { notice($("#passkey-message"), "Este navegador ou endereço não oferece suporte à biometria. Acesse pelo link HTTPS e use um aparelho compatível.", true); return; }
    if (!window.SimpleWebAuthnBrowser || typeof SimpleWebAuthnBrowser.startRegistration !== "function") { notice($("#passkey-message"), "O módulo de biometria não carregou. Recarregue a página e tente novamente.", true); return; }
    if (typeof SimpleWebAuthnBrowser.browserSupportsWebAuthn === "function" && !SimpleWebAuthnBrowser.browserSupportsWebAuthn()) { notice($("#passkey-message"), "Este navegador não oferece suporte a Passkeys. Tente pelo Chrome ou Safari atualizado.", true); return; }
    if (typeof SimpleWebAuthnBrowser.platformAuthenticatorIsAvailable === "function" && !(await SimpleWebAuthnBrowser.platformAuthenticatorIsAvailable())) { notice($("#passkey-message"), "Este aparelho não informou biometria ou PIN seguro integrado. Tente em um celular ou computador com Face ID, impressão digital ou Windows Hello.", true); return; }
    button.disabled = true; button.textContent = "Preparando cadastro...";
    try {
      const setup = await api("/api/webauthn/register/options", { method: "POST", body: JSON.stringify({}) });
      const response = await SimpleWebAuthnBrowser.startRegistration({ optionsJSON: setup.options });
      await api("/api/webauthn/register/verify", { method: "POST", body: JSON.stringify({ challengeId: setup.challengeId, response, deviceName: navigator.userAgent.slice(0, 80) }) });
      notice($("#passkey-message"), "Biometria cadastrada com sucesso! Nos próximos acessos, você poderá entrar usando este dispositivo.");
      await refreshPasskeyAvailability();
    } catch (err) { console.error("Falha no cadastro da Passkey:", err); notice($("#passkey-message"), err.message || "Não foi possível cadastrar a biometria. Confira as permissões e tente novamente.", true); }
    finally { button.disabled = false; button.textContent = "⌁ Cadastrar biometria neste dispositivo"; }
  });
  $("#passkey-login-btn").addEventListener("click", async () => {
    const button = $("#passkey-login-btn"); button.disabled = true; button.textContent = "Aguardando biometria...";
    try {
      const setup = await api("/api/webauthn/auth/options", { method: "POST", body: JSON.stringify({ role: "admin" }) });
      const response = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: setup.options });
      await api("/api/webauthn/auth/verify", { method: "POST", body: JSON.stringify({ role: "admin", challengeId: setup.challengeId, response }) });
      showDashboard(); await Promise.all([loadItems(), loadSettings()]);
    } catch (err) { notice($("#login-message"), err.message || "Não foi possível entrar com biometria.", true); }
    finally { button.disabled = false; button.textContent = "⌁ Entrar com biometria"; }
  });
  async function restoreAdminSession() {
    try {
      const response = await fetch("/api/session"); const data = await response.json();
      if (response.ok && data.authenticated && data.role === "admin") { showDashboard(); await Promise.all([loadItems(), loadSettings()]); }
      else { showLogin(); await refreshPasskeyAvailability(); }
    } catch { showLogin(); await refreshPasskeyAvailability(); }
  }

  restoreAdminSession();
})();
