// Página pública de solo lectura de una orden (orden.html?t=…) o un presupuesto (presupuesto.html?t=…).
// Sin sesión: la base solo devuelve el documento si el token de 64 caracteres coincide (orden_publica / presupuesto_publico).
import { sb } from "../sb.js";
import { h, fmtFecha, telWa } from "../util.js";
import { estadoBadge } from "../ui.js";
import { documento } from "../documento.js";

const tipo = document.body.dataset.doc;           // "orden" | "presupuesto"
const token = new URLSearchParams(location.search).get("t") || "";
const raiz = document.getElementById("doc");

function noDisponible() {
  raiz.replaceChildren(h("div", { class: "card state" },
    h("h1", {}, "Enlace no disponible"),
    h("p", {}, "Este enlace no es válido o el documento ya no está disponible. Pide al taller que te lo envíe de nuevo.")));
}

async function cargar() {
  if (!/^[0-9a-f]{64}$/.test(token)) return noDisponible();
  const { data, error } = await sb.rpc(tipo === "orden" ? "orden_publica" : "presupuesto_publico", { p_token: token });
  if (error) {
    raiz.replaceChildren(h("div", { class: "card state error" },
      h("p", {}, "No se pudo cargar el documento. Revisa tu conexión e inténtalo de nuevo."),
      h("button", { class: "btn primary", type: "button", onclick: () => location.reload() }, "Reintentar")));
    return;
  }
  if (!data) return noDisponible();

  const doc = tipo === "orden" ? data.orden : data.presupuesto;
  const t = data.taller || {};
  document.title = `${tipo === "orden" ? "Orden" : "Presupuesto"} ${doc.codigo} · ${t.nombre || "Taller"}`;

  const d = {
    tipoDoc: tipo, taller: t, codigo: doc.codigo,
    badge: tipo === "orden" ? estadoBadge(doc) : null,
    cliente: { nombre: data.cliente?.nombre },
    vehiculo: data.vehiculo,
    tipo: doc.tipo, motivo: doc.motivo, descripcion: doc.descripcion, ocultarDescripcionVacia: true,
    fecha_ingreso: doc.fecha_ingreso, kilometraje_ingreso: doc.kilometraje_ingreso, observacion_ingreso: doc.observacion_ingreso,
    fecha_salida: doc.fecha_salida, observacion_salida: doc.observacion_salida, observaciones: doc.observaciones,
    fecha: doc.fecha, valido_hasta: doc.valido_hasta,
    items: data.items || [], totales: data.totales, aplica_iva: doc.aplica_iva, iva_porcentaje: doc.iva_porcentaje,
    firmas: tipo === "presupuesto",
    datos_pago: t.datos_pago, copiarCuenta: true,
    pie: `Consultado el ${fmtFecha(new Date().toISOString())} · Documento de solo lectura · Desarrollado por Zynthea Solutions`,
  };

  const tel = telWa(t.telefono);
  const msg = `Hola, le escribo por ${tipo === "orden" ? "la orden" : "el presupuesto"} ${doc.codigo}.`;
  raiz.replaceChildren(
    h("div", { class: "actions no-print pub-actions" },
      h("button", { class: "btn primary", type: "button", onclick: () => window.print() }, "Imprimir o guardar PDF"),
      tel && h("a", { class: "btn whatsapp", href: `https://wa.me/${tel}?text=${encodeURIComponent(msg)}`, target: "_blank", rel: "noopener" },
        "Escribir al taller")),
    documento(d));
}

cargar();
