// Sección "Enviar al cliente" de una orden o un presupuesto.
//  · Celular / tableta: "Enviar PDF por WhatsApp" / "por correo" generan el PDF y abren el menú Compartir del teléfono
//    (navigator.share con el archivo y el mensaje). Si el teléfono no puede compartir archivos: descarga el PDF y abre
//    el chat (wa.me/593…) o el correo del cliente. Botones secundarios: "Abrir chat del cliente" / "Abrir correo del cliente".
//  · Computadora: nunca el panel Compartir de Windows. Descarga el PDF y abre el chat o el correo DEL CLIENTE con el
//    mensaje ya escrito; aviso "Adjunta el PDF descargado con el clip 📎".
//  · Enlace aparte: "Enviar enlace por WhatsApp" y "Copiar enlace".
// En producción el enlace es https://karenariasbme.github.io/zynthea-talleres/orden.html?t=… (en local sale localhost).
import { sb } from "./sb.js";
import { h, must, val, telWa, mailtoUrl, urlPublica, usd, toast, normPlaca, errMsg, tieneEstandar, textoPago } from "./util.js";
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
  const celular = esCelular();
  const cliente = { ...d.cliente };
  const esOrden = d.tipoDoc === "orden";
  const url = urlPublica(esOrden ? "orden.html" : "presupuesto.html", d.token);
  const que = esOrden ? "su orden de trabajo" : "su presupuesto";
  const Que = esOrden ? "Orden de trabajo" : "Presupuesto";
  const taller = d.taller?.nombre || "el taller";
  const total = Number(d.total) > 0 ? ` por un total de ${usd(d.total)}` : "";
  // Datos de pago del taller (Estándar): debajo del total; "" si no los llenó
  const pago = tieneEstandar(d.taller) ? textoPago(d.taller?.datos_pago) : "";
  const asunto = `${Que} ${d.codigo} · ${taller}`;
  const archivo = esOrden
    ? `Orden-${d.codigo}${d.placa ? `-${normPlaca(d.placa)}` : ""}.pdf`
    : `Presupuesto-${d.codigo}.pdf`;

  // Nombre completo del cliente (antes se tomaba solo la primera palabra); vacío → "Hola,"
  const saludo = () => {
    const nombre = (cliente.nombre || "").trim().replace(/\s+/g, " ");
    return `Hola${nombre ? ` ${nombre}` : ""}, le saluda ${taller}.`;
  };
  const textoPdf = () => `${saludo()} Le envío ${que} ${d.codigo}${total}. Le adjunto el PDF.${pago}\n\nGracias por su confianza.`;
  const textoEnlace = () => `${saludo()} Puede ver ${que} ${d.codigo}${total} en este enlace:\n${url}${pago}`;
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

  /** Enviar el PDF por el canal elegido ("whatsapp" | "correo"). */
  async function enviarPdf(canal, btn) {
    if (celular) {
      // Celular: menú Compartir con el archivo; el contacto se elige en WhatsApp o en la app de correo
      const file = await pdf(btn);
      if (!file) return;
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: asunto, text: textoPdf() });
          return;
        } catch (e) {
          if (e.name === "AbortError") return;                                   // cerró el menú Compartir
          if (e.name === "NotAllowedError") return compartirConToque(file, canal); // generar tardó: hace falta un toque nuevo
          // otro error: seguir como si no pudiera compartir
        }
      }
      return descargarYAbrir(canal, file);
    }
    // Computadora: descargar el PDF y abrir el chat / correo del cliente
    if (!exigirContacto(canal, () => enviarPdf(canal, btn))) return;
    const file = await pdf(btn);
    if (file) descargarYAbrir(canal, file);
  }

  /** Descarga el PDF y abre el chat o el correo del cliente, con el aviso de adjuntar. */
  function descargarYAbrir(canal, file) {
    if (!exigirContacto(canal, () => descargarYAbrir(canal, file))) return;
    descargar(file);
    const destino = canal === "whatsapp" ? chatCliente(textoPdf()) : mailtoUrl(cliente.correo, asunto, textoPdf());
    let abierto = false;
    if (canal === "whatsapp") abierto = !!window.open(destino, "_blank", "noopener");
    else { location.href = destino; abierto = true; }
    avisoAdjuntar(canal, destino, abierto);
  }

  /** Celular, botones secundarios: abrir el chat o el correo del cliente con el mensaje (sin PDF). */
  function abrirContacto(canal) {
    if (!exigirContacto(canal, () => abrirContacto(canal))) return;
    if (canal === "whatsapp") window.open(chatCliente(textoPdf()), "_blank", "noopener");
    else location.href = mailtoUrl(cliente.correo, asunto, textoPdf());
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

  function compartirConToque(file, canal) {
    const dlg = h("dialog", { class: "dlg" });
    dlg.append(h("div", { class: "dialog-form" },
      h("h2", {}, "PDF listo"),
      h("p", {}, `${file.name} está listo para compartir.`),
      h("div", { class: "actions" },
        h("button", { class: "btn ghost", type: "button", onclick: () => dlg.close() }, "Cancelar"),
        h("button", { class: "btn primary", type: "button", onclick: async () => {
          dlg.close();
          try { await navigator.share({ files: [file], title: asunto, text: textoPdf() }); }
          catch (e) { if (e.name !== "AbortError") descargarYAbrir(canal, file); }
        } }, "Compartir"))));
    dlg.addEventListener("close", () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }

  const btn = (cls, texto, fn) => h("button", { class: `btn ${cls}`, type: "button", onclick: (e) => fn(e.currentTarget) }, texto);
  const pdfWa = btn("whatsapp", "Enviar PDF por WhatsApp", (b) => enviarPdf("whatsapp", b));
  const pdfMail = btn("primary", "Enviar PDF por correo", (b) => enviarPdf("correo", b));
  const secundarios = celular
    ? [btn("ghost", "Abrir chat del cliente", () => abrirContacto("whatsapp")),
       btn("ghost", "Abrir correo del cliente", () => abrirContacto("correo"))]
    : [];
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
      h("div", { class: "actions" }, pdfWa, pdfMail),
      secundarios.length ? h("div", { class: "actions envio-secundarios" }, secundarios) : "",
      h("p", { class: "note" }, celular
        ? `Se genera ${archivo} (mismo diseño de la impresión, sin costos) y se abre el menú Compartir del teléfono `
          + "con el mensaje ya escrito: elige WhatsApp o tu correo y el contacto."
        : `Se descarga ${archivo} (mismo diseño de la impresión, sin costos) y se abre el chat o el correo `
          + "del cliente con el mensaje ya escrito. Solo adjuntas el PDF con el clip 📎.")),
    h("div", { class: "envio-grupo" },
      h("h3", {}, "Enlace de solo lectura"),
      h("div", { class: "actions" }, enlaceWa, copiar),
      h("p", { class: "note" }, "El enlace muestra el documento sin otros datos de tu taller.")));
}
