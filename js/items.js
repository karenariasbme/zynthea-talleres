// Secciones MANO DE OBRA y REPUESTOS dentro del formulario de la orden o del presupuesto.
// Las filas viven en el formulario y se guardan junto con la orden en UNA transacción
// (crear_orden_completa / editar_orden_completa / *_presupuesto_completo, sql/007).
// El costo de repuesto es opcional e interno: nunca sale en el documento del cliente.
import { sb } from "./sb.js";
import { h, must, usd } from "./util.js";
import { userError } from "./ui.js";

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;   // igual que round(…, 2) en la base
const aNum = (v) => {
  const t = String(v ?? "").trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

/** Ítems guardados de una orden o presupuesto, en el orden en que se escribieron. */
export async function cargarItems(tabla, fk, id) {
  return must(await sb.from(tabla).select("tipo,descripcion,cantidad,precio_unitario,costo_unitario,subtotal,created_at")
    .eq(fk, id).order("created_at"));
}

/** Totales calculados en el navegador (mismas reglas que las vistas ordenes_totales / presupuestos_totales). */
export function calcularTotales(items, aplicaIva, ivaPct) {
  let mano = 0, rep = 0;
  for (const i of items) {
    const st = r2((Number(i.cantidad) || 0) * (Number(i.precio_unitario) || 0));
    if (i.tipo === "repuesto") rep += st; else mano += st;   // "otro" (datos antiguos) cuenta con mano de obra
  }
  const subtotal = r2(mano + rep);
  const iva = aplicaIva ? r2(subtotal * (Number(ivaPct) || 0) / 100) : 0;
  return { total_mano_obra: r2(mano), total_repuestos: r2(rep), subtotal, iva, total: r2(subtotal + iva) };
}

/**
 * inicial = { items: [...], aplica_iva, iva_porcentaje }
 * Devuelve { el, leer() } — leer() valida y devuelve { items, aplica_iva, iva_porcentaje } o lanza un error para el usuario.
 */
export function lineasForm(inicial = {}) {
  const items = inicial.items || [];
  const filas = { mano: [], rep: [] };

  const cuerpoMano = h("tbody");
  const cuerpoRep = h("tbody");
  const vacioMano = h("p", { class: "note lineas-vacio" }, "Sin mano de obra todavía.");
  const vacioRep = h("p", { class: "note lineas-vacio" }, "Sin repuestos todavía.");

  const ivaCheck = h("input", { type: "checkbox", checked: inicial.aplica_iva ?? true });
  const ivaPct = h("input", { class: "input iva-pct", type: "text", inputmode: "decimal", value: String(inicial.iva_porcentaje ?? 15),
    "aria-label": "Porcentaje de IVA" });
  const tot = {
    mano: h("b"), rep: h("b"), sub: h("b"), iva: h("b"), total: h("b", { class: "total-grande" }),
    ivaLbl: h("span"),
  };

  function recalcular() {
    const lista = leerFilas(false);
    const pct = aNum(ivaPct.value);
    const t = calcularTotales(lista, ivaCheck.checked, Number.isFinite(pct) ? pct : 0);
    tot.mano.textContent = usd(t.total_mano_obra);
    tot.rep.textContent = usd(t.total_repuestos);
    tot.sub.textContent = usd(t.subtotal);
    tot.iva.textContent = usd(t.iva);
    tot.total.textContent = usd(t.total);
    ivaPct.disabled = !ivaCheck.checked;
    vacioMano.hidden = filas.mano.length > 0;
    vacioRep.hidden = filas.rep.length > 0;
    for (const f of [...filas.mano, ...filas.rep]) {
      const st = r2((aNum(f.cant.value) || 0) * (aNum(f.precio.value) || 0));
      f.subtotal.textContent = usd(st);
    }
  }

  const celda = (label, contenido, cls) => h("td", { "data-label": label, class: cls || null }, contenido);
  const inp = (props) => h("input", { class: "input", ...props, oninput: recalcular });

  function agregar(grupo, i = {}) {
    const esRep = grupo === "rep";
    const f = {
      tipo: i.tipo || (esRep ? "repuesto" : "mano_obra"),
      desc: inp({ type: "text", maxlength: 300, value: i.descripcion ?? "", placeholder: esRep ? "Ej.: pastillas de freno" : "Ej.: cambio de pastillas",
        "aria-label": "Descripción" }),
      cant: inp({ type: "text", inputmode: "decimal", value: i.cantidad ?? 1, "aria-label": "Cantidad", class: "input num-in" }),
      precio: inp({ type: "text", inputmode: "decimal", value: i.precio_unitario ?? "", placeholder: "0,00", "aria-label": "Precio unitario", class: "input num-in" }),
      costo: esRep ? inp({ type: "text", inputmode: "decimal", value: i.costo_unitario ?? "", placeholder: "Opcional",
        "aria-label": "Costo unitario (interno)", class: "input num-in" }) : null,
      subtotal: h("span", { class: "linea-sub" }),
    };
    const quitar = h("button", { class: "btn-icono", type: "button", "aria-label": "Quitar fila", title: "Quitar fila",
      onclick: () => { filas[grupo] = filas[grupo].filter((x) => x !== f); tr.remove(); recalcular(); } }, papelera());
    const tr = h("tr", {},
      celda("Descripción", f.desc, "col-desc"),
      celda("Cantidad", f.cant, "num"),
      celda("Precio unit.", f.precio, "num"),
      esRep && celda("Costo (interno)", f.costo, "num"),
      celda("Subtotal", f.subtotal, "num"),
      h("td", { class: "col-quitar" }, quitar));
    filas[grupo].push(f);
    (esRep ? cuerpoRep : cuerpoMano).append(tr);
    recalcular();
    return f;
  }

  for (const i of items) agregar(i.tipo === "repuesto" ? "rep" : "mano", i);

  const tabla = (grupo, cabeceras, cuerpo) => h("div", { class: "lineas-wrap" },
    h("table", { class: "lineas" },
      h("thead", {}, h("tr", {}, cabeceras.map((c) => h("th", { scope: "col", class: c.cls || null }, c.t)), h("th", { class: "col-quitar" }, h("span", { class: "sr-only" }, "Quitar")))),
      cuerpo));

  const seccionMano = h("section", { class: "lineas-sec" },
    h("h3", {}, "Mano de obra"),
    tabla("mano", [{ t: "Descripción" }, { t: "Cantidad", cls: "num" }, { t: "Precio unit.", cls: "num" }, { t: "Subtotal", cls: "num" }], cuerpoMano),
    vacioMano,
    h("button", { class: "btn small ghost", type: "button", onclick: () => agregar("mano").desc.focus() }, "+ Agregar mano de obra"));
  const seccionRep = h("section", { class: "lineas-sec" },
    h("h3", {}, "Repuestos"),
    tabla("rep", [{ t: "Descripción" }, { t: "Cantidad", cls: "num" }, { t: "Precio unit.", cls: "num" }, { t: "Costo (opcional)", cls: "num" }, { t: "Subtotal", cls: "num" }], cuerpoRep),
    vacioRep,
    h("button", { class: "btn small ghost", type: "button", onclick: () => agregar("rep").desc.focus() }, "+ Agregar repuesto"),
    h("p", { class: "note" }, "El costo es lo que te costó el repuesto: el cliente no lo ve y sirve para calcular tu ganancia."));

  ivaCheck.addEventListener("change", recalcular);
  ivaPct.addEventListener("input", recalcular);

  const linea = (label, valor, cls) => h("div", { class: `tot-line ${cls || ""}` }, h("span", {}, label), valor);
  const totales = h("div", { class: "totales-live", "aria-live": "polite" },
    linea("Subtotal mano de obra", tot.mano),
    linea("Subtotal repuestos", tot.rep),
    linea("Subtotal", tot.sub, "tot-sub"),
    h("div", { class: "tot-line iva-line" },
      h("label", { class: "iva-toggle" }, ivaCheck, " IVA"), ivaPct, h("span", { class: "muted" }, "%"), tot.iva),
    linea("TOTAL", tot.total, "tot-final"));

  /** Filas con datos; estricto = valida y lanza errores para el usuario. */
  function leerFilas(estricto) {
    const out = [];
    for (const [grupo, nombre] of [["mano", "Mano de obra"], ["rep", "Repuestos"]]) {
      filas[grupo].forEach((f, idx) => {
        const desc = f.desc.value.trim();
        const cant = aNum(f.cant.value);
        const precio = aNum(f.precio.value);
        const costo = f.costo ? aNum(f.costo.value) : null;
        const vacia = !desc && (precio == null) && (costo == null);
        if (vacia) return;   // fila en blanco: se ignora
        if (estricto) {
          const donde = `${nombre}, fila ${idx + 1}`;
          if (!desc) throw userError(`${donde}: escribe la descripción.`);
          if (!(cant > 0)) throw userError(`${donde}: la cantidad debe ser mayor que 0.`);
          if (precio == null || !(precio >= 0)) throw userError(`${donde}: escribe el precio unitario (0 o más).`);
          if (costo != null && !(costo >= 0)) throw userError(`${donde}: el costo debe ser 0 o más, o déjalo vacío.`);
        }
        out.push({ tipo: f.tipo, descripcion: desc, cantidad: cant, precio_unitario: precio, costo_unitario: costo });
      });
    }
    return out;
  }

  recalcular();
  return {
    el: h("div", { class: "card stack lineas-card" }, h("h2", {}, "Mano de obra y repuestos"), seccionMano, seccionRep, totales),
    leer() {
      const lista = leerFilas(true);
      const pct = aNum(ivaPct.value);
      if (ivaCheck.checked && !(pct >= 0 && pct <= 100)) throw userError("El IVA debe estar entre 0 y 100 %.");
      return { items: lista, aplica_iva: ivaCheck.checked, iva_porcentaje: Number.isFinite(pct) && pct >= 0 && pct <= 100 ? pct : 15 };
    },
  };
}

function papelera() {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("aria-hidden", "true");
  s.innerHTML = '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>';   // SVG fijo, sin datos del usuario
  return s;
}
