(() => {
  const $ = (selector) => document.querySelector(selector);
  const guestList = $("#guest-list");
  const form = $("#rsvp-form");
  const message = $("#form-message");
  let guestCounter = 0;
  const invitationToken = /^\\/convite\\/([a-f0-9]{64})$/i.exec(window.location.pathname)?.[1] || "";

  function addGuest(value = "") {
    if (guestList.children.length >= 20) {
      showMessage("O limite é de 20 pessoas por confirmação.", "error");
      return;
    }
    guestCounter += 1;
    const row = document.createElement("div");
    row.className = "guest-row";
    const input = document.createElement("input");
    input.type = "text";
    input.name = "guests";
    input.maxLength = 100;
    input.required = true;
    input.placeholder = guestList.children.length === 0 ? "Nome do responsável que irá à festa" : "Nome do acompanhante";
    input.autocomplete = "off";
    input.value = value;
    input.setAttribute("aria-label", "Nome da pessoa " + guestCounter);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-guest";
    remove.textContent = "×";
    remove.setAttribute("aria-label", "Remover pessoa");
    remove.addEventListener("click", () => {
      row.remove();
      updateGuestInputs();
    });
    row.append(input, remove);
    guestList.append(row);
    updateGuestInputs();
  }
  function updateGuestInputs() {
    [...guestList.querySelectorAll("input")].forEach((input, index) => {
      input.placeholder = index === 0 ? "Nome do responsável que irá à festa" : "Nome do acompanhante";
      input.required = document.querySelector('input[name="status"]:checked').value === "confirmed";
      input.setAttribute("aria-label", "Nome da pessoa " + (index + 1));
    });
    $("#add-guest").hidden = guestList.children.length >= 20;
  }
  function showMessage(text, type) {
    message.textContent = text;
    message.className = "form-message show " + type;
    message.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  $("#add-guest").addEventListener("click", () => addGuest());
  document.querySelectorAll('input[name="status"]').forEach(radio => radio.addEventListener("change", () => {
    const confirmed = document.querySelector('input[name="status"]:checked').value === "confirmed";
    guestList.querySelectorAll("input").forEach(input => input.required = confirmed);
    $("#add-guest").disabled = !confirmed;
  }));
  addGuest();

  async function loadConfig() {
    try {
      if (!invitationToken) {
        form.hidden = true;
        $("#invite-access-message").hidden = false;
        $("#invite-access-message").textContent = "Este é um convite pessoal. Peça à família o seu link individual para confirmar presença.";
      } else {
        const inviteResponse = await fetch("/api/invitation/" + encodeURIComponent(invitationToken));
        const inviteData = await inviteResponse.json();
        if (!inviteResponse.ok || !inviteData.valid) throw new Error(inviteData.error || "Link de convite inválido.");
      }
      const response = await fetch("/api/config");
      const config = await response.json();
      $("#event-name").textContent = config.eventName + "!";
      $("#event-age").textContent = config.age;
      document.title = "Aniversário da " + config.eventName + " | Convite especial";
      const dateValue = String(config.date || "Data a definir");
      const parsedDate = /^\\d{4}-\\d{2}-\\d{2}$/.test(dateValue) ? new Date(dateValue + "T12:00:00") : null;
      $("#event-date").textContent = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }) : dateValue;
      $("#event-time").textContent = config.time || "Horário a definir";
      $("#event-venue").textContent = config.venue || "Local a definir";
      $("#event-address").textContent = config.address || "Endereço a definir";
      $("#map-link").hidden = !config.mapUrl;
      if (config.mapUrl) $("#map-link").href = config.mapUrl;
      if (config.deadline) {
        const deadline = new Date(config.deadline + "T23:59:59");
        if (!Number.isNaN(deadline.getTime()) && Date.now() > deadline.getTime()) {
          form.querySelectorAll("input,textarea,button").forEach(el => el.disabled = true);
          showMessage("O prazo para confirmar presença foi encerrado. Obrigado!", "error");
        }
      }
    } catch (error) {
      form.hidden = true;
      $("#invite-access-message").hidden = false;
      $("#invite-access-message").textContent = error.message || "Este link já foi utilizado ou expirou. Peça um novo convite à família.";
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.className = "form-message";
    const status = document.querySelector('input[name="status"]:checked').value;
    const names = [...guestList.querySelectorAll("input")].map(input => input.value.trim()).filter(Boolean);
    const uniqueNames = new Set(names.map(name => name.toLocaleLowerCase("pt-BR")));
    if (status === "confirmed" && names.length === 0) return showMessage("Adicione o nome de pelo menos uma pessoa.", "error");
    if (uniqueNames.size !== names.length) return showMessage("Há nomes repetidos. Confira a lista de acompanhantes.", "error");
    const button = form.querySelector(".submit-button");
    button.disabled = true;
    button.querySelector("span").textContent = "Enviando sua resposta...";
    try {
      if (!invitationToken) throw new Error("Abra o link pessoal enviado pela família para confirmar presença.");
      const response = await fetch("/api/rsvp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inviteToken: invitationToken,
          responsible: $("#responsible").value.trim(),
          phone: $("#phone").value.trim(),
          guests: names,
          notes: $("#notes").value.trim(),
          status
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível enviar sua resposta.");
      form.reset();
      guestList.replaceChildren();
      addGuest();
      if (status === "confirmed" && data.ticketToken) {
        form.hidden = true;
        $("#ticket-receipt").hidden = false;
        const qrTarget = $("#ticket-qr"); qrTarget.replaceChildren();
        if (window.QRCode) new QRCode(qrTarget, { text: data.ticketToken, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });
        else { $("#invite-access-message").hidden = false; $("#invite-access-message").textContent = "Não foi possível gerar o QR Code neste aparelho. Entre em contato com a família."; }
        const namesBox = $("#ticket-guest-names"); namesBox.replaceChildren();
        const title = document.createElement("strong"); title.textContent = "Pessoas confirmadas"; namesBox.append(title);
        (data.guests || []).forEach(name => { const line = document.createElement("span"); line.textContent = "✓ " + name; namesBox.append(line); });
        $("#ticket-receipt").scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        form.hidden = true;
        $("#invite-access-message").hidden = false;
        $("#invite-access-message").textContent = data.message;
      }
      if (status === "confirmed") {
        const confetti = document.createElement("div");
        confetti.className = "celebration-overlay";
        confetti.setAttribute("aria-hidden", "true");
        confetti.textContent = "✦  ✧  ★  ♡  ✦  ★  ✧  ♡  ✦";
        document.body.append(confetti);
        window.setTimeout(() => confetti.remove(), 2600);
      }
    } catch (error) {
      showMessage(error.message || "Erro de conexão. Tente novamente.", "error");
    } finally {
      button.disabled = false;
      button.querySelector("span").textContent = "Confirmar minha resposta";
      updateGuestInputs();
    }
  });
  $("#save-ticket-btn").addEventListener("click", () => {
    const canvas = $("#ticket-qr canvas");
    const image = $("#ticket-qr img");
    const source = canvas ? canvas.toDataURL("image/png") : image?.src;
    if (!source) return;
    const link = document.createElement("a"); link.href = source; link.download = "comprovante-agnes-qr.png"; link.click();
  });
  loadConfig();
})();
