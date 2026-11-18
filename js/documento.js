// Documento profesional de orden de trabajo o presupuesto (pantalla, impresión y enlace público).
// Lo usan la app (con sesión) y orden.html / presupuesto.html (sin sesión). Nunca muestra costos.
import { h, formatPlaca, fmtFecha, usd } from "./util.js";
import { tallerLogo } from "./ui.js";
import { calcularTotales } from "./items.js";

export const TIPO_ITEM = { mano_obra: "Mano de obra", repuesto: "Repuesto", otro: "Otro" };

// Nombres de los campos (todos los planes)
export const ETQ = {
  ingreso: "Estado del vehículo al ingreso",
  salida: "Salida del vehículo",
  observaciones: "Observaciones del trabajo a realizar",
  km: "Kilometraje de ingreso",
};

const vacio = (v) => v == null || v === "";
const km = (n) => (vacio(n) ? null : `${Number(n).toLocaleString("es-EC")} km`);
const cant = (n) => Number(n).toLocaleString("es-EC", { maximumFractionDigits: 3 });

/** Par etiqueta / valor en la ficha (se omite si no hay valor, salvo forzar). */
const par = (label, valor, forzar) => (vacio(valor) && !forzar ? null
  : h("div", { class: "dc-par" }, h("dt", {}, label), h("dd", {}, vacio(valor) ? "—" : valor)));

function ficha(titulo, pares) {
  const visibles = pares.filter(Boolean);
  return h("section", { class: "dc-ficha" }, h("h3", {}, titulo),
    visibles.length ? h("dl", {}, visibles) : h("p", { class: "dc-nada" }, "—"));
}

function bloqueTexto(titulo, texto) {
  if (vacio(texto)) return null;
  return h("section", { class: "dc-bloque" }, h("h3", {}, titulo), h("p", { class: "dc-texto" }, texto));
}

/** Tabla de mano de obra o de repuestos (precio de venta; el costo nunca aparece). */
function tablaLineas(titulo, filas) {
  return h("section", { class: "dc-bloque" },
    h("h3", {}, titulo),
    filas.length
      ? h("table", { class: "dc-tabla" },
          h("thead", {}, h("tr", {},
            h("th", { scope: "col" }, "Descripción"),
            h("th", { scope: "col", class: "num" }, "Cant."),
            h("th", { scope: "col", class: "num" }, "P. unit."),
            h("th", { scope: "col", class: "num" }, "Subtotal"))),
          h("tbody", {}, filas.map((i) => h("tr", {},
            h("td", { "data-label": "Descripción" }, i.descripcion),
            h("td", { class: "num", "data-label": "Cantidad" }, cant(i.cantidad)),
            h("td", { class: "num", "data-label": "P. unit." }, usd(i.precio_unitario)),
            h("td", { class: "num", "data-label": "Subtotal" },
              usd(i.subtotal ?? Math.round(Number(i.cantidad) * Number(i.precio_unitario) * 100) / 100))))))
      : h("p", { class: "dc-nada" }, "—"));
}

function cajaTotales(t, aplicaIva, ivaPct) {
  const fila = (label, valor, cls) => h("div", { class: `dc-tot ${cls || ""}` }, h("span", {}, label), h("b", {}, usd(valor)));
  return h("div", { class: "dc-totales" },
    fila("Subtotal mano de obra", Number(t.total_mano_obra) + Number(t.total_otros || 0)),
    fila("Subtotal repuestos", t.total_repuestos),
    fila("Subtotal", t.subtotal, "dc-tot-sub"),
    fila(aplicaIva ? `IVA ${Number(ivaPct).toLocaleString("es-EC")} %` : "IVA (no aplica)", t.iva),
    fila("TOTAL", t.total, "dc-tot-final"));
}

/**
 * d = { tipoDoc: "orden" | "presupuesto", taller, codigo, badge, cliente, vehiculo, tipo, motivo, descripcion,
 *       fecha_ingreso, kilometraje_ingreso, observacion_ingreso, fecha_salida, observacion_salida, observaciones,
 *       fecha, valido_hasta, items, totales, aplica_iva, iva_porcentaje, firmas, pie, conPrecios }
 * conPrecios = false (Plan Básico): sin tablas ni totales.
 */
export function documento(d) {
  const t = d.taller || {};
  const v = d.vehiculo;
  const esOrden = d.tipoDoc === "orden";
  const items = d.items || [];
  const mano = items.filter((i) => i.tipo !== "repuesto");
  const rep = items.filter((i) => i.tipo === "repuesto");
  const totales = d.totales || calcularTotales(items, d.aplica_iva, d.iva_porcentaje);
  const conPrecios = d.conPrecios !== false;

  return h("article", { class: "card print-doc doc-pro" },
    // Encabezado: taller a la izquierda, número de documento a la derecha
    h("header", { class: "dc-head" },
      h("div", { class: "dc-taller" },
        tallerLogo(t, "doc"),
        h("div", {},
          h("p", { class: "dc-taller-nombre" }, t.nombre || ""),
          t.ruc && h("p", {}, `RUC ${t.ruc}`),
          t.direccion && h("p", {}, t.direccion),
          (t.telefono || t.correo) && h("p", {}, [t.telefono, t.correo].filter(Boolean).join(" · ")))),
      h("div", { class: "dc-num" },
        h("span", { class: "dc-kind" }, esOrden ? "Orden de trabajo" : "Presupuesto"),
        h("span", { class: "dc-codigo" }, d.codigo),
        h("span", { class: "dc-fecha" }, esOrden ? `Ingreso: ${fmtFecha(d.fecha_ingreso)}` : `Fecha: ${fmtFecha(d.fecha)}`),
        !esOrden && d.valido_hasta && h("span", { class: "dc-fecha" }, `Válido hasta: ${fmtFecha(d.valido_hasta)}`),
        d.badge)),

    // Cliente y vehículo
    h("div", { class: "dc-fichas" },
      ficha("Cliente", [
        par("Nombre", d.cliente?.nombre, true),
        d.cliente?.cedula_ruc !== undefined && par("Cédula / RUC", d.cliente.cedula_ruc),
        d.cliente?.telefono !== undefined && par("Teléfono", d.cliente.telefono),
      ]),
      ficha("Vehículo", v ? [
        h("div", { class: "dc-par" }, h("dt", {}, "Placa"), h("dd", {}, h("span", { class: "plate" }, formatPlaca(v.placa)))),
        par("Marca y modelo", `${v.marca} ${v.modelo}`),
        par("Año", v.anio),
        par("Color", v.color),
        esOrden && par("Kilometraje", km(d.kilometraje_ingreso)),
      ] : [h("p", { class: "dc-nada" }, "Sin vehículo asignado")])),

    // Trabajo
    h("section", { class: "dc-bloque" },
      h("h3", {}, "Trabajo"),
      h("dl", { class: "dc-lista" },
        esOrden && par("Tipo de mantenimiento", d.tipo === "preventivo" ? "Preventivo" : "Correctivo"),
        par("Motivo", d.motivo, true),
        par("Descripción", d.descripcion))),
    esOrden ? bloqueTexto(ETQ.ingreso, d.observacion_ingreso) : null,
    bloqueTexto(ETQ.observaciones, d.observaciones),

    // Mano de obra, repuestos y totales
    conPrecios ? tablaLineas("Mano de obra", mano) : null,
    conPrecios ? tablaLineas("Repuestos", rep) : null,
    conPrecios ? cajaTotales(totales, d.aplica_iva, d.iva_porcentaje) : null,

    // Salida (solo orden entregada)
    esOrden && d.fecha_salida
      ? h("section", { class: "dc-bloque" }, h("h3", {}, "Entrega"),
          h("dl", { class: "dc-lista" },
            par("Fecha de salida", fmtFecha(d.fecha_salida), true),
            par(ETQ.salida, d.observacion_salida)))
      : null,

    d.firmas !== false && h("footer", { class: "dc-firmas" },
      h("div", { class: "firma" }, esOrden ? "Firma del cliente" : "Aceptación del cliente"),
      h("div", { class: "firma" }, "Firma del taller")),
    h("p", { class: "doc-gen" }, d.pie || `Generado el ${fmtFecha(new Date().toISOString())} · Desarrollado por Zynthea Solutions`));
}
