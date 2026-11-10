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
  async function buildTicketPdf() {
    const qrContainer = $("#ticket-qr");
    const qrCanvas = qrContainer && qrContainer.querySelector("canvas");
    const qrImage = qrContainer && qrContainer.querySelector("img");
    if (!qrCanvas && !qrImage) throw new Error("O QR Code ainda não está pronto. Aguarde alguns segundos e tente novamente.");
    if (!window.jspdf || !window.jspdf.jsPDF) throw new Error("O gerador de PDF não carregou. Atualize a página e tente novamente.");

    let qrData;
    try {
      if (qrCanvas && qrCanvas.width > 0 && qrCanvas.height > 0) {
        qrData = qrCanvas.toDataURL("image/png");
      } else if (qrImage) {
        if (!qrImage.complete || !qrImage.naturalWidth) {
          await new Promise((resolve, reject) => {
            qrImage.addEventListener("load", resolve, { once: true });
            qrImage.addEventListener("error", () => reject(new Error("Não foi possível carregar a imagem do QR Code.")), { once: true });
          });
        }
        qrData = qrImage.src;
      }
      if (!qrData || !qrData.startsWith("data:image/")) throw new Error("Imagem do QR Code inválida.");
    } catch (error) {
      throw new Error(error.message || "Não foi possível preparar o QR Code para o PDF.");
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageW = 210;
    const pink = [238, 35, 137];
    const darkPink = [190, 20, 103];
    const ink = [54, 39, 52];
    const pale = [255, 241, 249];
    const softPink = [255, 220, 238];
    const name = eventConfig.eventName || "Agnes";
    const date = $("#ticket-event-date").textContent || "A confirmar";
    const time = $("#ticket-event-time").textContent || "A confirmar";
    const venue = $("#ticket-event-venue").textContent || "A confirmar";
    const address = $("#ticket-event-address").textContent || "A confirmar";
    const mapUrl = eventConfig.mapUrl || "";

    doc.setProperties({
      title: "Comprovante de entrada - Aniversário de " + name,
      subject: "Comprovante de confirmação com QR Code",
      author: "Convite de aniversário"
    });

    // Fundo e moldura em estilo de quadrinhos, usando apenas a paleta da festa.
    doc.setFillColor(...pale);
    doc.rect(0, 0, pageW, 297, "F");
    doc.setFillColor(...pink);
    doc.roundedRect(8, 8, 194, 48, 7, 7, "F");
    doc.setFillColor(255, 202, 226);
    doc.circle(15, 15, 13, "F");
    doc.circle(196, 51, 15, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text(String(name).toLocaleUpperCase("pt-BR"), 105, 27, { align: "center", maxWidth: 174 });
    doc.setFontSize(12);
    doc.text("COMPROVANTE DE CONFIRMACAO", 105, 39, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("Sua presenca esta confirmada!", 105, 48, { align: "center" });

    doc.setTextColor(...darkPink);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text("QR CODE DE ENTRADA", 105, 70, { align: "center" });
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(...softPink);
    doc.setLineWidth(1.2);
    doc.roundedRect(62, 76, 86, 86, 5, 5, "FD");
    doc.addImage(qrData, "PNG", 67, 81, 76, 76, undefined, "FAST");
    doc.setTextColor(...ink);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text("Apresente este QR Code na portaria.", 105, 170, { align: "center" });

    // Cartao de detalhes da festa.
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(...softPink);
    doc.roundedRect(15, 181, 180, 79, 5, 5, "FD");
    doc.setFillColor(...pink);
    doc.roundedRect(15, 181, 180, 14, 5, 5, "F");
    doc.rect(15, 190, 180, 5, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("DETALHES DA FESTA", 105, 190, { align: "center" });

    let y = 207;
    const detailRows = [
      ["DATA", date],
      ["HORARIO", time],
      ["LOCAL", venue],
      ["ENDERECO", address]
    ];
    detailRows.forEach(([label, value]) => {
      doc.setTextColor(...darkPink);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text(label, 24, y);
      doc.setTextColor(...ink);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      const lines = doc.splitTextToSize(String(value), 145);
      doc.text(lines.slice(0, 2), 55, y);
      y += Math.max(11, lines.slice(0, 2).length * 5 + 3);
    });

    if (mapUrl) {
      doc.setFillColor(...pink);
      doc.roundedRect(35, 265, 140, 12, 6, 6, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text("ABRIR LOCALIZACAO NO GOOGLE MAPS", 105, 273, { align: "center" });
      doc.link(35, 265, 140, 12, { url: mapUrl });
    } else {
      doc.setTextColor(...darkPink);
      doc.setFontSize(9);
      doc.text("Consulte o endereco informado acima para chegar a festa.", 105, 272, { align: "center", maxWidth: 170 });
    }

    doc.setTextColor(120, 83, 106);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.text("Guarde este comprovante. O QR Code e individual e deve ser apresentado na entrada.", 105, 287, { align: "center", maxWidth: 185 });
    return doc.output("blob");
  }

  function downloadTicketPdf(blob) {
    if (!(blob instanceof Blob) || blob.size === 0) throw new Error("O PDF foi gerado vazio. Tente novamente.");
    const pdfBlob = blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" });
    const url = URL.createObjectURL(pdfBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "comprovante-agnes.pdf";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Mantém a URL viva por mais tempo para aparelhos que iniciam o download
    // de forma assíncrona; em navegadores móveis o PDF pode abrir em nova aba.
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  $("#save-ticket-btn").addEventListener("click", async () => {
    const button = $("#save-ticket-btn");
    button.disabled = true;
    try {
      downloadTicketPdf(await buildTicketPdf());
      $("#ticket-share-message").textContent = "PDF gerado. Guarde o comprovante para apresentar na portaria.";
    } catch (error) {
      $("#ticket-share-message").textContent = error.message || "Nao foi possivel gerar o PDF.";
    } finally {
      button.disabled = false;
    }
  });

  $("#share-ticket-btn").addEventListener("click", async () => {
    const button = $("#share-ticket-btn");
    button.disabled = true;
    try {
      const blob = await buildTicketPdf();
      const file = new File([blob], "comprovante-agnes.pdf", { type: "application/pdf" });
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: "Comprovante de entrada - Aniversario de " + (eventConfig.eventName || "Agnes"),
          text: "Segue o comprovante em PDF. Apresente o QR Code na portaria."
        });
        $("#ticket-share-message").textContent = "PDF compartilhado. Guarde-o para apresentar na portaria.";
      } else {
        downloadTicketPdf(blob);
        $("#ticket-share-message").textContent = "PDF salvo no aparelho. Agora basta anexar o arquivo no WhatsApp ou WhatsApp Business.";
      }
    } catch (error) {
      if (error.name !== "AbortError") $("#ticket-share-message").textContent = error.message || "Nao foi possivel compartilhar o PDF.";
    } finally {
      button.disabled = false;
    }
  });
  loadConfig();
})();
