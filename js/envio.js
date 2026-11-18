// Sección "Enviar al cliente" de una orden o un presupuesto:
//  · PDF: "Enviar PDF por WhatsApp" / "Enviar PDF por correo". En el celular se comparte el archivo con navigator.share;
//    en la computadora se descarga el PDF y se abre WhatsApp / el correo del cliente con el mensaje ya escrito.
//  · Enlace: "Enviar enlace por WhatsApp" y "Copiar enlace" (página pública de solo lectura con token de 64 caracteres).
import { h, telWa, mailtoUrl, urlPublica, usd, toast, normPlaca } from "./util.js";
import { generarPdf, descargar } from "./pdf.js";

/**
 * d = { taller, tipoDoc: "orden" | "presupuesto", codigo, placa, token, cliente: { nombre, telefono, correo }, total,
 *       docEl: () => Element }   // docEl devuelve el documento que se ve en pantalla (el mismo que se imprime)
 */
export function botonesEnvio(d) {
  const esOrden = d.tipoDoc === "orden";
  const url = urlPublica(esOrden ? "orden.html" : "presupuesto.html", d.token);
  const que = esOrden ? "su orden de trabajo" : "su presupuesto";
  const Que = esOrden ? "Orden de trabajo" : "Presupuesto";
  const taller = d.taller?.nombre || "el taller";
  const total = Number(d.total) > 0 ? ` por un total de ${usd(d.total)}` : "";
  const nombre = (d.cliente?.nombre || "").split(" ")[0];
  const saludo = `Hola${nombre ? ` ${nombre}` : ""}, le saluda ${taller}.`;
  const asunto = `${Que} ${d.codigo} · ${taller}`;
  const textoPdf = `${saludo} Le envío ${que} ${d.codigo}${total}. Adjunto el PDF.\n\nGracias por su confianza.`;
  const textoEnlace = `${saludo} Puede ver ${que} ${d.codigo}${total} en este enlace:\n${url}`;
  const archivo = esOrden
    ? `Orden-${d.codigo}${d.placa ? `-${normPlaca(d.placa)}` : ""}.pdf`
    : `Presupuesto-${d.codigo}.pdf`;

  const tel = telWa(d.cliente?.telefono);
  const waHref = (texto) => `https://wa.me/${tel}?text=${encodeURIComponent(texto)}`;
  const mailHref = (texto) => mailtoUrl(d.cliente?.correo, asunto, texto);

  /** Generar el PDF y enviarlo por el canal elegido ("whatsapp" | "correo"). */
  async function enviarPdf(canal, btn) {
    const etiqueta = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Generando PDF…";
    let file;
    try {
      file = await generarPdf(d.docEl?.(), archivo);
    } catch (e) {
      toast(e.message || "No se pudo generar el PDF.", "error");
      return;
    } finally {
      btn.disabled = false;
      btn.textContent = etiqueta;
    }

    // Celular: compartir el archivo con el mensaje (el usuario elige WhatsApp o su app de correo)
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: asunto, text: textoPdf });
        return;
      } catch (e) {
        if (e.name === "AbortError") return;                                  // canceló el menú de compartir
        if (e.name === "NotAllowedError") return compartirConToque(file);     // el navegador pide un toque nuevo
        // cualquier otro error: seguir con la descarga
      }
    }

    // Computadora: descargar el PDF y abrir WhatsApp / correo del cliente con el mismo mensaje
    descargar(file);
    const destino = canal === "whatsapp" ? waHref(textoPdf) : mailHref(textoPdf);
    if (canal === "whatsapp") {
      const w = window.open(destino, "_blank", "noopener");
      if (!w) return avisoAdjuntar(canal, destino);   // ventana bloqueada: abrir con un toque
    } else {
      location.href = destino;
    }
    toast("Adjunta el PDF descargado", "ok");
    avisoAdjuntar(canal, destino);
  }

  /** Si se perdió el "toque" mientras se generaba el PDF, se comparte con un toque nuevo. */
  function compartirConToque(file) {
    const dlg = h("dialog", { class: "dlg" });
    dlg.append(h("div", { class: "dialog-form" },
      h("h2", {}, "PDF listo"),
      h("p", {}, `${file.name} está listo para enviar.`),
      h("div", { class: "actions" },
        h("button", { class: "btn ghost", type: "button", onclick: () => dlg.close() }, "Cancelar"),
        h("button", { class: "btn primary", type: "button", onclick: async () => {
          dlg.close();
          try { await navigator.share({ files: [file], title: asunto, text: textoPdf }); }
          catch (e) { if (e.name !== "AbortError") { descargar(file); toast("Adjunta el PDF descargado", "ok"); } }
        } }, "Compartir"))));
    dlg.addEventListener("close", () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }

  /** Aviso en la computadora: el PDF se descargó y hay que adjuntarlo. */
  function avisoAdjuntar(canal, destino) {
    const dlg = h("dialog", { class: "dlg" });
    dlg.append(h("div", { class: "dialog-form" },
      h("h2", {}, "Adjunta el PDF descargado"),
      h("p", {}, `Se descargó ${archivo}. En ${canal === "whatsapp" ? "WhatsApp" : "tu correo"} el mensaje ya está escrito: `
        + "adjunta el archivo desde tu carpeta de Descargas y envía."),
      h("div", { class: "actions" },
        h("button", { class: "btn ghost", type: "button", onclick: () => dlg.close() }, "Listo"),
        h("a", { class: `btn ${canal === "whatsapp" ? "whatsapp" : "primary"}`, href: destino,
          target: canal === "whatsapp" ? "_blank" : null, rel: "noopener", onclick: () => dlg.close() },
          canal === "whatsapp" ? "Abrir WhatsApp" : "Abrir correo"))));
    dlg.addEventListener("close", () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }

  const pdfWa = h("button", { class: "btn whatsapp", type: "button", onclick: (e) => enviarPdf("whatsapp", e.currentTarget) }, "Enviar PDF por WhatsApp");
  const pdfMail = h("button", { class: "btn primary", type: "button", onclick: (e) => enviarPdf("correo", e.currentTarget) }, "Enviar PDF por correo");
  const enlaceWa = h("a", { class: "btn ghost", href: waHref(textoEnlace), target: "_blank", rel: "noopener" }, "Enviar enlace por WhatsApp");
  const copiar = h("button", { class: "btn ghost", type: "button", onclick: async () => {
    try { await navigator.clipboard.writeText(url); toast("Enlace copiado"); }
    catch { prompt("Copia el enlace:", url); }
  } }, "Copiar enlace");

  const avisos = [];
  if (!tel) avisos.push("El cliente no tiene un teléfono válido: WhatsApp te pedirá elegir el contacto.");
  if (!d.cliente?.correo) avisos.push("El cliente no tiene correo registrado: escríbelo en el correo que se abre.");

  return h("div", { class: "card stack envio no-print" },
    h("h2", {}, "Enviar al cliente"),
    h("div", { class: "envio-grupo" },
      h("h3", {}, "PDF del documento"),
      h("div", { class: "actions" }, pdfWa, pdfMail),
      h("p", { class: "note" }, `Se genera ${archivo} con el mismo diseño de la impresión, sin costos. `
        + "En el celular se comparte el archivo; en la computadora se descarga para adjuntarlo.")),
    h("div", { class: "envio-grupo" },
      h("h3", {}, "Enlace de solo lectura"),
      h("div", { class: "actions" }, enlaceWa, copiar),
      h("p", { class: "note" }, "El enlace muestra el documento sin otros datos de tu taller.")),
    avisos.length ? h("p", { class: "note" }, avisos.join(" ")) : "");
}
