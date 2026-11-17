// Documento de orden de trabajo o presupuesto (vista imprimible).
// Lo usan la app (con sesión) y las páginas públicas orden.html / presupuesto.html (sin sesión).
// Nunca muestra costos: solo precios de venta.
import { h, formatPlaca, fmtFecha, usd } from "./util.js";
import { tallerLogo } from "./ui.js";

export const TIPO_ITEM = { mano_obra: "Mano de obra", repuesto: "Repuesto", otro: "Otro" };

// Nombres de los campos (todos los planes)
export const ETQ = {
  ingreso: "Estado del vehículo al ingreso",
  salida: "Salida del vehículo",
  observaciones: "Observaciones del trabajo a realizar",
  km: "Kilometraje de ingreso",
};

const dato = (label, value) =>
  h("div", { class: "dato" }, h("dt", {}, label), h("dd", {}, value == null || value === "" ? "—" : value));

const km = (n) => (n == null ? null : `${Number(n).toLocaleString("es-EC")} km`);

/** Tabla de ítems y totales (precios de venta). */
export function tablaItems(items, totales, ivaPct, aplicaIva) {
  if (!items?.length) return null;
  const t = totales || {};
  const fila = (label, valor, fuerte) =>
    h("tr", { class: fuerte ? "tot-final" : null }, h("th", { colspan: 4, scope: "row" }, label), h("td", {}, usd(valor)));
  return h("div", { class: "items-wrap" },
    h("table", { class: "items-table" },
      h("thead", {}, h("tr", {},
        h("th", { scope: "col" }, "Descripción"), h("th", { scope: "col" }, "Tipo"),
        h("th", { scope: "col", class: "num" }, "Cant."), h("th", { scope: "col", class: "num" }, "P. unit."),
        h("th", { scope: "col", class: "num" }, "Subtotal"))),
      h("tbody", {}, items.map((i) => h("tr", {},
        h("td", {}, i.descripcion), h("td", {}, TIPO_ITEM[i.tipo] || i.tipo),
        h("td", { class: "num" }, Number(i.cantidad).toLocaleString("es-EC")),
        h("td", { class: "num" }, usd(i.precio_unitario)), h("td", { class: "num" }, usd(i.subtotal))))),
      h("tfoot", {},
        Number(t.total_mano_obra) > 0 && fila("Mano de obra", t.total_mano_obra),
        Number(t.total_repuestos) > 0 && fila("Repuestos", t.total_repuestos),
        Number(t.total_otros) > 0 && fila("Otros", t.total_otros),
        fila("Subtotal", t.subtotal),
        fila(aplicaIva ? `IVA ${Number(ivaPct).toLocaleString("es-EC")} %` : "IVA (no aplica)", t.iva),
        fila("Total", t.total, true))));
}

/**
 * d = { tipoDoc: "orden" | "presupuesto", taller, codigo, badge, cliente, vehiculo, tipo, motivo, descripcion,
 *       fecha_ingreso, kilometraje_ingreso, observacion_ingreso, fecha_salida, observacion_salida, observaciones,
 *       fecha, valido_hasta, items, totales, aplica_iva, iva_porcentaje, firmas, pie }
 */
export function documento(d) {
  const t = d.taller || {};
  const v = d.vehiculo;
  const esOrden = d.tipoDoc === "orden";
  return h("article", { class: "card print-doc" },
    h("header", { class: "doc-head" },
      h("div", { class: "doc-brand" },
        tallerLogo(t, "doc"),
        h("div", {},
          h("p", { class: "doc-taller" }, t.nombre || ""),
          t.ruc && h("p", { class: "doc-line" }, `RUC: ${t.ruc}`),
          t.direccion && h("p", { class: "doc-line" }, t.direccion),
          (t.telefono || t.correo) && h("p", { class: "doc-line" }, [t.telefono, t.correo].filter(Boolean).join(" · ")))),
      h("div", { class: "doc-code" },
        h("span", { class: "doc-kind" }, esOrden ? "Orden de trabajo" : "Presupuesto"),
        h("span", { class: "doc-num" }, d.codigo),
        d.badge)),
    h("div", { class: "doc-cols" },
      h("section", {},
        h("h3", {}, "Cliente"),
        h("dl", {},
          dato("Nombre", d.cliente?.nombre),
          d.cliente?.cedula_ruc !== undefined && dato("Cédula / RUC", d.cliente.cedula_ruc),
          d.cliente?.telefono !== undefined && dato("Teléfono", d.cliente.telefono))),
      h("section", {},
        h("h3", {}, "Vehículo"),
        v ? h("dl", {},
              dato("Placa", formatPlaca(v.placa)),
              dato("Marca y modelo", `${v.marca} ${v.modelo}`),
              dato("Año", v.anio),
              dato("Color", v.color))
          : h("p", { class: "muted" }, "Sin vehículo asignado"))),
    h("section", {},
      h("h3", {}, "Trabajo"),
      h("dl", {},
        esOrden && dato("Tipo de mantenimiento", d.tipo === "preventivo" ? "Preventivo" : "Correctivo"),
        dato("Motivo", d.motivo),
        dato("Descripción", d.descripcion))),
    esOrden
      ? h("div", { class: "doc-cols" },
          h("section", {},
            h("h3", {}, "Ingreso"),
            h("dl", {},
              dato("Fecha y hora", fmtFecha(d.fecha_ingreso)),
              d.kilometraje_ingreso != null && dato("Kilometraje", km(d.kilometraje_ingreso)),
              dato(ETQ.ingreso, d.observacion_ingreso))),
          h("section", {},
            h("h3", {}, "Salida"),
            h("dl", {},
              dato("Fecha y hora", d.fecha_salida ? fmtFecha(d.fecha_salida) : "Pendiente"),
              dato(ETQ.salida, d.observacion_salida))))
      : h("section", {},
          h("h3", {}, "Validez"),
          h("dl", {},
            dato("Fecha", fmtFecha(d.fecha)),
            dato("Válido hasta", fmtFecha(d.valido_hasta)))),
    d.items?.length
      ? h("section", {}, h("h3", {}, esOrden ? "Mano de obra y repuestos" : "Detalle del presupuesto"),
          tablaItems(d.items, d.totales, d.iva_porcentaje, d.aplica_iva))
      : null,
    h("section", {},
      h("h3", {}, ETQ.observaciones),
      h("p", { class: "doc-obs" }, d.observaciones || "—")),
    d.firmas !== false && h("footer", { class: "doc-foot" },
      h("div", { class: "firma" }, esOrden ? "Firma del cliente" : "Aceptación del cliente"),
      h("div", { class: "firma" }, "Firma del taller")),
    h("p", { class: "doc-gen" }, d.pie || `Generado el ${fmtFecha(new Date().toISOString())} · Desarrollado por Zynthea Solutions`));
}
