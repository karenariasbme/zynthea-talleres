// Reporte del mes (Plan Estándar): órdenes entregadas en el mes, ingresos y ganancia.
// Ganancia de una orden = venta sin IVA − costo. Si algún repuesto no tiene costo, esa orden cuenta solo como ingreso.
import { sb } from "../sb.js";
import { h, must, usd, formatPlaca, fmtFecha, rangoMes, mesActual, tieneEstandar, errMsg } from "../util.js";
import { state } from "../state.js";
import { pageHead, input, empty, loading, errorBox, bloqueoEstandar } from "../ui.js";

const XLSX_URL = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
let cargaXlsx = null;
/** Excel (~900 KB) se descarga solo la primera vez que se exporta. */
function xlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  cargaXlsx ??= new Promise((ok, mal) => {
    const s = document.createElement("script");
    s.src = XLSX_URL;
    s.onload = () => ok(window.XLSX);
    s.onerror = () => { cargaXlsx = null; mal(new Error("No se pudo cargar Excel. Revisa tu conexión.")); };
    document.head.append(s);
  });
  return cargaXlsx;
}

const nombreMes = (yyyyMm) => {
  const [y, m] = yyyyMm.split("-").map(Number);
  return new Intl.DateTimeFormat("es-EC", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 15)));
};

async function datosMes(mes) {
  const [desde, hasta] = rangoMes(mes);
  const ordenes = must(await sb.from("historial_ordenes")
    .select("id,codigo,fecha_ingreso,fecha_salida,placa,marca,modelo,cliente_nombre,motivo,kilometraje_ingreso")
    .gte("fecha_salida", desde).lt("fecha_salida", hasta).order("fecha_salida").limit(2000));
  if (!ordenes.length) return [];
  const ids = ordenes.map((o) => o.id);
  const [rt, rc] = await Promise.all([
    sb.from("ordenes_totales").select("*").in("orden_id", ids),
    sb.from("ordenes_costos").select("*").in("orden_id", ids),
  ]);
  const tot = new Map(must(rt).map((t) => [t.orden_id, t]));
  const cos = new Map(must(rc).map((c) => [c.orden_id, c]));
  return ordenes.map((o) => {
    const t = tot.get(o.id) || {};
    const c = cos.get(o.id) || { costo: 0, repuestos_sin_costo: 0 };
    const venta = Number(t.subtotal) || 0;
    const conCosto = c.repuestos_sin_costo === 0 && venta > 0;
    return { ...o, t, costo: Number(c.costo) || 0, sinCosto: c.repuestos_sin_costo, conCosto,
             ganancia: conCosto ? venta - (Number(c.costo) || 0) : null };
  });
}

export async function render(box, arg) {
  if (!tieneEstandar(state.taller)) {
    return box.append(pageHead("Reportes"),
      bloqueoEstandar(state.taller, "Reporte de ganancias del mes",
        "Ingresos por mano de obra y repuestos, IVA, costo y ganancia de cada mes, con descarga en Excel."));
  }
  const mes = /^\d{4}-\d{2}$/.test(arg || "") ? arg : mesActual();
  const selMes = input({ type: "month", value: mes, max: mesActual(), "aria-label": "Mes del reporte" });
  selMes.addEventListener("change", () => { if (selMes.value) location.hash = `#reportes/${selMes.value}`; });
  const cuerpo = h("div", { class: "stack-lg" }, loading());
  const btnXls = h("button", { class: "btn ghost", type: "button", disabled: true }, "Descargar Excel");

  box.append(
    pageHead("Reportes", "Órdenes entregadas en el mes", h("div", { class: "row" }, selMes, btnXls)),
    cuerpo);

  let filas;
  try {
    filas = await datosMes(mes);
  } catch (e) {
    return cuerpo.replaceChildren(errorBox(errMsg(e)));
  }
  if (!filas.length) return cuerpo.replaceChildren(empty(`No hay órdenes entregadas en ${nombreMes(mes)}. El reporte cuenta las órdenes por su fecha de salida.`));

  const suma = (f) => filas.reduce((a, o) => a + (Number(f(o)) || 0), 0);
  const r = {
    mano: suma((o) => o.t.total_mano_obra), rep: suma((o) => o.t.total_repuestos), otros: suma((o) => o.t.total_otros),
    sub: suma((o) => o.t.subtotal), iva: suma((o) => o.t.iva), total: suma((o) => o.t.total),
  };
  const conCosto = filas.filter((o) => o.conCosto);
  const ventaConCosto = conCosto.reduce((a, o) => a + (Number(o.t.subtotal) || 0), 0);
  const costo = conCosto.reduce((a, o) => a + o.costo, 0);
  const ganancia = ventaConCosto - costo;
  const soloIngresos = filas.length - conCosto.length;

  const tile = (label, valor, nota, cls) => h("div", { class: `card stat ${cls || ""}` },
    h("span", { class: "stat-label" }, label), h("b", { class: "stat-valor" }, valor), nota && h("span", { class: "muted" }, nota));

  cuerpo.replaceChildren(
    h("div", { class: "stats" },
      tile("Órdenes entregadas", String(filas.length)),
      tile("Ingresos sin IVA", usd(r.sub), `Mano de obra ${usd(r.mano)} · Repuestos ${usd(r.rep)}${r.otros ? ` · Otros ${usd(r.otros)}` : ""}`),
      tile("IVA cobrado", usd(r.iva)),
      tile("Total cobrado", usd(r.total), null, "destacado"),
      conCosto.length
        ? tile("Ganancia", usd(ganancia), `${conCosto.length} orden(es) con costo: venta ${usd(ventaConCosto)} − costo ${usd(costo)}`, ganancia >= 0 ? "ok" : "mal")
        : tile("Ganancia", "—", "Agrega el costo de los repuestos en las órdenes para verla.")),
    soloIngresos > 0 ? h("p", { class: "msg warn" },
      `${soloIngresos} orden(es) tienen repuestos sin costo: cuentan solo como ingresos y no entran en la ganancia.`) : "",
    h("div", { class: "card table-card" },
      h("table", { class: "items-table rep-table" },
        h("thead", {}, h("tr", {},
          ["Orden", "Entregada", "Vehículo", "Cliente", "Sin IVA", "Total", "Ganancia"].map((c, i) =>
            h("th", { scope: "col", class: i >= 4 ? "num" : null }, c)))),
        h("tbody", {}, filas.map((o) => h("tr", {},
          h("td", {}, h("a", { href: `#orden/${encodeURIComponent(o.id)}` }, o.codigo)),
          h("td", {}, fmtFecha(o.fecha_salida)),
          h("td", {}, `${formatPlaca(o.placa)} ${o.marca} ${o.modelo}`),
          h("td", {}, o.cliente_nombre),
          h("td", { class: "num" }, usd(o.t.subtotal)),
          h("td", { class: "num" }, usd(o.t.total)),
          h("td", { class: "num" }, o.ganancia == null ? h("span", { class: "muted", title: "Solo ingresos: faltan costos" }, "solo ingresos") : usd(o.ganancia))))))));

  btnXls.disabled = false;
  btnXls.addEventListener("click", async () => {
    btnXls.disabled = true;
    const texto = btnXls.textContent;
    btnXls.textContent = "Preparando…";
    try {
      const X = await xlsx();
      const n2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
      const hoja = filas.map((o) => ({
        Orden: o.codigo, Ingreso: fmtFecha(o.fecha_ingreso), Entregada: fmtFecha(o.fecha_salida),
        Placa: formatPlaca(o.placa), Vehículo: `${o.marca} ${o.modelo}`, Cliente: o.cliente_nombre, Motivo: o.motivo,
        Kilometraje: o.kilometraje_ingreso ?? "",
        "Mano de obra": n2(o.t.total_mano_obra), Repuestos: n2(o.t.total_repuestos), Otros: n2(o.t.total_otros),
        "Subtotal sin IVA": n2(o.t.subtotal), IVA: n2(o.t.iva), Total: n2(o.t.total),
        Costo: o.conCosto ? n2(o.costo) : "", Ganancia: o.ganancia == null ? "solo ingresos" : n2(o.ganancia),
      }));
      const resumen = [
        { Concepto: "Mes", Valor: nombreMes(mes) },
        { Concepto: "Órdenes entregadas", Valor: filas.length },
        { Concepto: "Mano de obra", Valor: n2(r.mano) }, { Concepto: "Repuestos", Valor: n2(r.rep) }, { Concepto: "Otros", Valor: n2(r.otros) },
        { Concepto: "Ingresos sin IVA", Valor: n2(r.sub) }, { Concepto: "IVA", Valor: n2(r.iva) }, { Concepto: "Total cobrado", Valor: n2(r.total) },
        { Concepto: "Órdenes con costo completo", Valor: conCosto.length },
        { Concepto: "Costo (órdenes con costo)", Valor: n2(costo) }, { Concepto: "Ganancia (órdenes con costo)", Valor: n2(ganancia) },
        { Concepto: "Órdenes solo ingresos (sin costo)", Valor: soloIngresos },
      ];
      const wb = X.utils.book_new();
      X.utils.book_append_sheet(wb, X.utils.json_to_sheet(resumen), "Resumen");
      X.utils.book_append_sheet(wb, X.utils.json_to_sheet(hoja), "Órdenes");
      X.writeFile(wb, `Reporte_${mes}_${(state.taller.nombre || "taller").replace(/[^\p{L}\p{N}]+/gu, "_")}.xlsx`);
    } catch (e) {
      alert(e.message || errMsg(e));
    } finally {
      btnXls.disabled = false;
      btnXls.textContent = texto;
    }
  });
}
