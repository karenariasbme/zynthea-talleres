// Sección "Enviar al cliente" de una orden o un presupuesto.
//  · "Enviar PDF por WhatsApp" (computadora y celular): descarga el PDF y abre el chat DEL CLIENTE
//    (wa.me/593…) con el mensaje ya escrito; el usuario adjunta el PDF con el clip.
//  · "Enviar PDF por correo": descarga el PDF y abre un correo al cliente (mailto) con el mismo mensaje.
//  · "Compartir PDF" (solo en celular): menú del teléfono con el archivo (navigator.share).
//  · Enlace aparte: "Enviar enlace por WhatsApp" y "Copiar enlace".
// En producción el enlace es https://karenariasbme.github.io/zynthea-talleres/orden.html?t=… (en local sale localhost).
import { sb } from "./sb.js";
import { h, must, val, telWa, mailtoUrl, urlPublica, usd, toast, normPlaca, errMsg } from "./util.js";
import { field, input, openDialog, userError } from "./ui.js";
import { generarPdf, descargar } from "./pdf.js";

/** Celular o tableta: pantalla táctil como puntero principal o sistema móvil. Windows/Mac nunca usan navigator.share aquí. */
const esCelular = () =>
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.userAgentData?.mobile ?? false)
  || (matchMedia("(pointer: coarse)").matches && !/Windows|Macintosh|Linux x86_64/i.test(navigator.userAgent));

/**
 * d = { taller, tipoDoc: "orden" | "presupuesto", codigo, placa, token, total,
 *       cliente: { id, nombre, telefono, correo }, docEl: () => Element }
 */
export function botonesEnvio(d) {
  const cliente = { ...d.cliente };
  const esOrden = d.tipoDoc === "orden";
  const url = urlPublica(esOrden ? "orden.html" : "presupuesto.html", d.token);
  const que = esOrden ? "su orden de trabajo" : "su presupuesto";
  const Que = esOrden ? "Orden de trabajo" : "Presupuesto";
  const taller = d.taller?.nombre || "el taller";
  const total = Number(d.total) > 0 ? ` por un total de ${usd(d.total)}` : "";
  const asunto = `${Que} ${d.codigo} · ${taller}`;
  const archivo = esOrden
    ? `Orden-${d.codigo}${d.placa ? `-${normPlaca(d.placa)}` : ""}.pdf`
    : `Presupuesto-${d.codigo}.pdf`;

  // Nombre completo del cliente (antes se tomaba solo la primera palabra); vacío → "Hola,"
  const saludo = () => {
    const nombre = (cliente.nombre || "").trim().replace(/\s+/g, " ");
    return `Hola${nombre ? ` ${nombre}` : ""}, le saluda ${taller}.`;
  };
  const textoPdf = () => `${saludo()} Le envío ${que} ${d.codigo}${total}. Le adjunto el PDF.\n\nGracias por su confianza.`;
  const textoEnlace = () => `${saludo()} Puede ver ${que} ${d.codigo}${total} en este enlace:\n${url}`;
  const chatCliente = (texto) => `https://wa.me/${telWa(cliente.telefono)}?text=${encodeURIComponent(texto)}`;

  /** Editar teléfono y correo del cliente sin salir de la orden. */
  function editarCliente(motivo, despues) {
    if (!cliente.id) { location.hash = "#clientes"; return; }
    openDialog("Editar cliente", h("div", { class: "stack" },
      h("p", { class: "msg warn" }, motivo),
      h("p", {}, h("b", {}, cliente.nombre || "Cliente")),
      field("WhatsApp / teléfono", input({ name: "telefono", type: "tel", maxlength: 20, value: cliente.telefono ?? "", placeholder: "0991234567" }),
        "Se usa como 593XXXXXXXXX: si empieza con 0, se cambia el 0 por 593."),
      field("Correo", input({ name: "correo", type: "email", maxlength: 120, value: cliente.correo ?? "" }))), {
      submitLabel: "Guardar y continuar",
      onSubmit: async (fd) => {
        const telefono = val(fd, "telefono");
        const correo = val(fd, "correo");
        if (telefono && !telWa(telefono)) throw userError("Ese teléfono no es válido. Escríbelo así: 0991234567.");
        if (correo && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) throw userError("Escribe un correo válido.");
        must(await sb.from("clientes").update({ telefono, correo }).eq("id", cliente.id).select("id").single());
        Object.assign(cliente, { telefono, correo });
        toast("Cliente actualizado");
        pintarAvisos();
        despues?.();
      },
    });
  }

  /** El cliente necesita WhatsApp (canal "whatsapp") o correo (canal "correo"); si falta, se ofrece editarlo. */
  function exigirContacto(canal, continuar) {
    if (canal === "whatsapp" && !telWa(cliente.telefono)) {
      editarCliente("Este cliente no tiene WhatsApp registrado.", continuar);
      return false;
    }
    if (canal === "correo" && !cliente.correo) {
      editarCliente("Este cliente no tiene correo registrado.", continuar);
      return false;
    }
    return true;
  }

  async function pdf(btn) {
    const etiqueta = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Generando PDF…";
    try {
      return await generarPdf(d.docEl?.(), archivo);
    } catch (e) {
      toast(e.message || errMsg(e), "error");
      return null;
    } finally {
      btn.disabled = false;
      btn.textContent = etiqueta;
    }
  }

  /** Descarga el PDF y abre el chat del cliente o el correo, con el aviso de adjuntar. */
  async function enviarPdf(canal, btn) {
    if (!exigirContacto(canal, () => enviarPdf(canal, btn))) return;
    const file = await pdf(btn);
    if (!file) return;
    descargar(file);
    const destino = canal === "whatsapp" ? chatCliente(textoPdf()) : mailtoUrl(cliente.correo, asunto, textoPdf());
    let abierto = false;
    if (canal === "whatsapp") abierto = !!window.open(destino, "_blank", "noopener");
    else { location.href = destino; abierto = true; }
    avisoAdjuntar(canal, destino, abierto);
  }

  function avisoAdjuntar(canal, destino, abierto) {
    const wa = canal === "whatsapp";
    const dlg = h("dialog", { class: "dlg" });
    dlg.append(h("div", { class: "dialog-form" },
      h("h2", {}, "Adjunta el PDF descargado con el clip 📎"),
      h("p", {}, `Se descargó ${archivo}. `,
        wa ? `En el chat de ${cliente.nombre || "tu cliente"} el mensaje ya está escrito: toca el clip 📎, elige el PDF de tus Descargas y envía.`
           : "En el correo el mensaje ya está escrito: adjunta el PDF de tus Descargas con el clip 📎 y envía."),
      !abierto && h("p", { class: "note" }, "El navegador no abrió la ventana sola: usa el botón."),
      h("div", { class: "actions" },
        h("button", { class: "btn ghost", type: "button", onclick: () => dlg.close() }, "Listo"),
        h("a", { class: `btn ${wa ? "whatsapp" : "primary"}`, href: destino, target: wa ? "_blank" : null, rel: "noopener",
          onclick: () => dlg.close() }, wa ? "Abrir chat del cliente" : "Abrir correo"))));
    dlg.addEventListener("close", () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
    toast("Adjunta el PDF descargado con el clip 📎", "ok");
  }

  /** Solo celular: menú Compartir del teléfono con el archivo. */
  async function compartirPdf(btn) {
    const file = await pdf(btn);
    if (!file) return;
    if (!navigator.canShare?.({ files: [file] })) {
      descargar(file);
      toast("Este teléfono no permite compartir archivos: el PDF se descargó.", "ok");
      return;
    }
    try {
      await navigator.share({ files: [file], title: asunto, text: textoPdf() });
    } catch (e) {
      if (e.name === "AbortError") return;
      if (e.name === "NotAllowedError") return compartirConToque(file);   // generar tardó: hace falta un toque nuevo
      descargar(file);
      toast("No se pudo compartir: el PDF se descargó.", "ok");
    }
  }

  function compartirConToque(file) {
    const dlg = h("dialog", { class: "dlg" });
    dlg.append(h("div", { class: "dialog-form" },
      h("h2", {}, "PDF listo"),
      h("p", {}, `${file.name} está listo para compartir.`),
      h("div", { class: "actions" },
        h("button", { class: "btn ghost", type: "button", onclick: () => dlg.close() }, "Cancelar"),
        h("button", { class: "btn primary", type: "button", onclick: async () => {
          dlg.close();
          try { await navigator.share({ files: [file], title: asunto, text: textoPdf() }); }
          catch (e) { if (e.name !== "AbortError") { descargar(file); toast("No se pudo compartir: el PDF se descargó.", "ok"); } }
        } }, "Compartir"))));
    dlg.addEventListener("close", () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }

  const btn = (cls, texto, fn) => h("button", { class: `btn ${cls}`, type: "button", onclick: (e) => fn(e.currentTarget) }, texto);
  const pdfWa = btn("whatsapp", "Enviar PDF por WhatsApp", (b) => enviarPdf("whatsapp", b));
  const pdfMail = btn("primary", "Enviar PDF por correo", (b) => enviarPdf("correo", b));
  const compartir = esCelular() ? btn("ghost", "Compartir PDF", compartirPdf) : null;
  const enlaceWa = btn("ghost", "Enviar enlace por WhatsApp", () => {
    if (!exigirContacto("whatsapp", () => window.open(chatCliente(textoEnlace()), "_blank", "noopener"))) return;
    window.open(chatCliente(textoEnlace()), "_blank", "noopener");
  });
  const copiar = btn("ghost", "Copiar enlace", async () => {
    try { await navigator.clipboard.writeText(url); toast("Enlace copiado"); }
    catch { prompt("Copia el enlace:", url); }
  });

  const avisos = h("div");
  function pintarAvisos() {
    const faltan = [];
    if (!telWa(cliente.telefono)) faltan.push("Este cliente no tiene WhatsApp registrado.");
    if (!cliente.correo) faltan.push("No tiene correo registrado.");
    avisos.replaceChildren(...(faltan.length ? [h("div", { class: "msg warn envio-aviso" },
      h("span", {}, faltan.join(" ")),
      h("button", { class: "btn small ghost", type: "button", onclick: () => editarCliente(faltan.join(" ")) }, "Editar cliente"))] : []));
  }
  pintarAvisos();

  return h("div", { class: "card stack envio no-print" },
    h("h2", {}, "Enviar al cliente"),
    avisos,
    h("div", { class: "envio-grupo" },
      h("h3", {}, "PDF del documento"),
      h("div", { class: "actions" }, pdfWa, pdfMail, compartir),
      h("p", { class: "note" }, `Se descarga ${archivo} (mismo diseño de la impresión, sin costos) y se abre el chat o el correo `
        + "del cliente con el mensaje ya escrito. Solo adjuntas el PDF con el clip 📎.")),
    h("div", { class: "envio-grupo" },
      h("h3", {}, "Enlace de solo lectura"),
      h("div", { class: "actions" }, enlaceWa, copiar),
      h("p", { class: "note" }, "El enlace muestra el documento sin otros datos de tu taller.")));
}
