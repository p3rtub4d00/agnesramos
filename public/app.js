(() => {
  const $ = (selector) => document.querySelector(selector);
  const guestList = $("#guest-list");
  const form = $("#rsvp-form");
  const message = $("#form-message");
  let guestCounter = 0;
  let eventConfig = {};
  const invitationToken = window.location.pathname.split("/")[2] || "";

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
    input.placeholder = "Nome do acompanhante";
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
      input.placeholder = "Nome do acompanhante";
      input.required = document.querySelector('input[name="status"]:checked').value === "confirmed";
      input.setAttribute("aria-label", "Nome da pessoa " + (index + 1));
    });
    $("#add-guest").hidden = guestList.children.length >= 20;
  }
  function setTextIfPresent(selector, value) {
    const element = $(selector);
    if (element) element.textContent = value == null ? "" : String(value);
  }

  function showMessage(text, type) {
    if (!message) return;
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
  // O responsável já é contado automaticamente como convidado no servidor.
  // A lista começa vazia e recebe apenas acompanhantes opcionais.

  async function fetchWithRetry(url, attempts = 8) {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const response = await fetch(url, { cache: "no-store" });
        if (response.status !== 503 || attempt === attempts - 1) return response;
        lastError = new Error("O banco de dados ainda está iniciando.");
      } catch (error) {
        lastError = error;
        if (attempt === attempts - 1) throw error;
      }
      await new Promise(resolve => window.setTimeout(resolve, 1250));
    }
    throw lastError || new Error("Não foi possível carregar os dados.");
  }

  async function loadConfig() {
    try {
      if (!invitationToken) {
        form.hidden = true;
        $("#invite-access-message").hidden = false;
        $("#invite-access-message").textContent = "Este é um convite pessoal. Peça à família o seu link individual para confirmar presença.";
      } else {
        const inviteResponse = await fetchWithRetry("/api/invitation/" + encodeURIComponent(invitationToken));
        const inviteData = await inviteResponse.json();
        if (!inviteResponse.ok || !inviteData.valid) throw new Error(inviteData.error || "Link de convite inválido.");
        const skipButton = $("#skip-watched-video");
        if (skipButton) {
          skipButton.hidden = !inviteData.videoWatched;
          if (inviteData.videoWatched) {
            const video = $("#invite-video");
            const videoActions = $("#video-end-actions");
            if (video) video.pause();
            if (videoActions) videoActions.hidden = false;
            $("#video-intro-stage")?.classList.add("video-finished");
          }
        }
      }
      const response = await fetchWithRetry("/api/config");
      const config = await response.json();
      eventConfig = config || {};
      if (!response.ok) throw new Error(config.error || "Não foi possível carregar as informações da festa.");
      // O layout atual começa pelo vídeo e não contém mais os antigos elementos
      // event-name/event-age. Atualize-os somente se existirem para não interromper
      // a leitura dos dados de local, data e horário.
      setTextIfPresent("#event-name", (config.eventName || "Agnes") + "!");
      setTextIfPresent("#event-age", config.age || "5");
      document.title = "Aniversário da " + config.eventName + " | Convite especial";
      const dateValue = String(config.date || "Data a definir");
      const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(dateValue) ? new Date(dateValue + "T12:00:00") : null;
      setTextIfPresent("#event-date", parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }) : dateValue);
      setTextIfPresent("#event-time", config.time || "Horário a definir");
      setTextIfPresent("#event-venue", config.venue || "Local a definir");
      setTextIfPresent("#event-address", config.address || "Endereço a definir");
      const mapLink = $("#map-link");
      if (mapLink) {
        mapLink.hidden = !config.mapUrl;
        if (config.mapUrl) mapLink.href = config.mapUrl;
      }
      if (config.deadline) {
        const deadline = new Date(config.deadline + "T23:59:59");
        if (!Number.isNaN(deadline.getTime()) && Date.now() > deadline.getTime()) {
          form.querySelectorAll("input,textarea,button").forEach(el => el.disabled = true);
          showMessage("O prazo para confirmar presença foi encerrado. Obrigado!", "error");
        }
      }
    } catch (error) {
      if (form) form.hidden = true;
      const accessMessage = $("#invite-access-message");
      if (accessMessage) {
        accessMessage.hidden = false;
        accessMessage.textContent = error.message || "Este link já foi utilizado ou expirou. Peça um novo convite à família.";
      }
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.className = "form-message";
    const status = document.querySelector('input[name="status"]:checked').value;
    const names = [...guestList.querySelectorAll("input")].map(input => input.value.trim()).filter(Boolean);
    const uniqueNames = new Set(names.map(name => name.toLocaleLowerCase("pt-BR")));
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
      if (status === "confirmed" && data.ticketToken) {
        form.hidden = true;
        $("#ticket-receipt").hidden = false;
        const qrTarget = $("#ticket-qr"); qrTarget.replaceChildren();
        if (window.QRCode) new QRCode(qrTarget, { text: data.ticketToken, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });
        else { $("#invite-access-message").hidden = false; $("#invite-access-message").textContent = "Não foi possível gerar o QR Code neste aparelho. Entre em contato com a família."; }
        renderTicketEventDetails();
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
  function renderTicketEventDetails() {
    const value = String(eventConfig.date || "A confirmar");
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + "T12:00:00") : null;
    $("#ticket-event-date").textContent = parsed && !Number.isNaN(parsed.getTime()) ? parsed.toLocaleDateString("pt-BR", {day:"2-digit",month:"long",year:"numeric"}) : value;
    $("#ticket-event-time").textContent = eventConfig.time || "A confirmar";
    $("#ticket-event-venue").textContent = eventConfig.venue || "A confirmar";
    $("#ticket-event-address").textContent = eventConfig.address || "A confirmar";
    const map = $("#ticket-event-map"); map.hidden = !eventConfig.mapUrl; if (eventConfig.mapUrl) map.href = eventConfig.mapUrl;
  }
  function ticketShareText() {
    return "Comprovante de entrada — Aniversário da " + (eventConfig.eventName || "Agnes") +
      "\nData: " + $("#ticket-event-date").textContent + "\nHorário: " + $("#ticket-event-time").textContent +
      "\nLocal: " + $("#ticket-event-venue").textContent + "\nEndereço: " + $("#ticket-event-address").textContent +
      (eventConfig.mapUrl ? "\nComo chegar: " + eventConfig.mapUrl : "") + "\nApresente o QR Code na portaria.";
  }
  async function buildTicketImage() {
    const qr = $("#ticket-qr canvas"); if (!qr) throw new Error("O QR Code ainda não está pronto.");
    const canvas = document.createElement("canvas"); canvas.width=1000; canvas.height=1420;
    const ctx=canvas.getContext("2d"); ctx.fillStyle="#fff8fc"; ctx.fillRect(0,0,1000,1420);
    ctx.strokeStyle="#f3a5c9";ctx.lineWidth=12;ctx.strokeRect(24,24,952,1372);
    ctx.textAlign="center";ctx.fillStyle="#d92f83";ctx.font="bold 52px Arial";ctx.fillText("ANIVERSÁRIO DA "+(eventConfig.eventName||"AGNES").toLocaleUpperCase("pt-BR"),500,105);
    ctx.fillStyle="#6b5260";ctx.font="30px Arial";ctx.fillText("Comprovante de confirmação · Entrada",500,160);
    ctx.drawImage(qr,300,205,400,400);
    ctx.textAlign="left";ctx.fillStyle="#d92f83";ctx.font="bold 32px Arial";ctx.fillText("DETALHES DA FESTA",90,680);
    ctx.fillStyle="#382b33";ctx.font="28px Arial";
    ["Data: "+$("#ticket-event-date").textContent,"Horário: "+$("#ticket-event-time").textContent,"Local: "+$("#ticket-event-venue").textContent,"Endereço: "+$("#ticket-event-address").textContent].forEach((line,i)=>ctx.fillText(line.slice(0,58),90,740+i*52));
    ctx.textAlign="center";ctx.fillStyle="#765568";ctx.font="24px Arial";ctx.fillText("Apresente este QR Code na portaria",500,1325);
    return await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
  }
  function saveTicketBlob(blob) {
    if(!blob) throw new Error("Não foi possível gerar a imagem.");
    const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download="comprovante-agnes.png";link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1500);
  }
  $("#save-ticket-btn").addEventListener("click", async()=>{try{saveTicketBlob(await buildTicketImage());}catch(e){$("#ticket-share-message").textContent=e.message;}});
  $("#share-ticket-btn").addEventListener("click", async()=>{
    const button=$("#share-ticket-btn");button.disabled=true;
    try{
      const blob=await buildTicketImage();const file=new File([blob],"comprovante-agnes.png",{type:"image/png"});
      if(navigator.share&&navigator.canShare&&navigator.canShare({files:[file]})){
        await navigator.share({files:[file],title:"Comprovante de entrada",text:ticketShareText()});
        $("#ticket-share-message").textContent="Comprovante compartilhado. Guarde-o para apresentar na portaria.";
      }else{saveTicketBlob(blob);$("#ticket-share-message").textContent="Imagem salva. Anexe o PNG no WhatsApp ou WhatsApp Business. Os detalhes e o link do Maps também estão no texto desta tela.";}
    }catch(e){if(e.name!=="AbortError")$("#ticket-share-message").textContent=e.message||"Não foi possível compartilhar.";}
    finally{button.disabled=false;}
  });
  loadConfig();
})();
