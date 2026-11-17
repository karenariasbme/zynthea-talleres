// Botones "Enviar por WhatsApp", "Enviar por correo" y "Copiar enlace" de una orden o un presupuesto.
// El enlace público es de solo lectura y lleva un token aleatorio de 64 caracteres (lo genera la base).
import { h, telWa, mailtoUrl, urlPublica, usd, toast } from "./util.js";

/**
 * d = { taller, tipoDoc: "orden" | "presupuesto", codigo, token, cliente: { nombre, telefono, correo }, total }
 */
export function botonesEnvio(d) {
  const pagina = d.tipoDoc === "orden" ? "orden.html" : "presupuesto.html";
  const url = urlPublica(pagina, d.token);
  const que = d.tipoDoc === "orden" ? "su orden de trabajo" : "su presupuesto";
  const Que = d.tipoDoc === "orden" ? "Orden de trabajo" : "Presupuesto";
  const total = Number(d.total) > 0 ? ` por un total de ${usd(d.total)}` : "";
  const nombre = (d.cliente?.nombre || "").split(" ")[0];
  const texto = `Hola${nombre ? ` ${nombre}` : ""}, le saluda ${d.taller?.nombre || "el taller"}. `
    + `Puede ver ${que} ${d.codigo}${total} en este enlace:\n${url}`;

  const tel = telWa(d.cliente?.telefono);
  const wa = h("a", { class: "btn whatsapp", href: `https://wa.me/${tel}?text=${encodeURIComponent(texto)}`,
    target: "_blank", rel: "noopener" }, "Enviar por WhatsApp");
  const mail = h("a", { class: "btn ghost",
    href: mailtoUrl(d.cliente?.correo, `${Que} ${d.codigo} · ${d.taller?.nombre || ""}`, `${texto}\n\nGracias por su confianza.`) },
    "Enviar por correo");
  const copiar = h("button", { class: "btn ghost", type: "button", onclick: async () => {
    try { await navigator.clipboard.writeText(url); toast("Enlace copiado"); }
    catch { prompt("Copia el enlace:", url); }
  } }, "Copiar enlace");

  const avisos = [];
  if (!tel) avisos.push("El cliente no tiene un teléfono válido: WhatsApp te pedirá elegir el contacto.");
  if (!d.cliente?.correo) avisos.push("El cliente no tiene correo registrado: escríbelo en el correo que se abre.");

  return h("div", { class: "card stack envio no-print" },
    h("h2", {}, "Enviar al cliente"),
    h("div", { class: "actions" }, wa, mail, copiar),
    h("p", { class: "note" }, "El enlace muestra el documento en solo lectura, sin otros datos de tu taller.",
      avisos.length ? ` ${avisos.join(" ")}` : ""));
}
