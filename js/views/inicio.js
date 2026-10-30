import { sb } from "../sb.js";
import { h, must, normPlaca, formatPlaca, limpiarBusqueda, errMsg } from "../util.js";
import { pageHead, orderCard, empty, input, loading, errorBox } from "../ui.js";

export async function render(box) {
  const [ra, ru] = await Promise.all([
    sb.from("historial_ordenes").select("*").is("fecha_salida", null)
      .order("fecha_ingreso", { ascending: false }).order("numero", { ascending: false }),
    sb.from("historial_ordenes").select("*").order("numero", { ascending: false }).limit(10),
  ]);
  const abiertas = must(ra);
  const ultimas = must(ru);

  box.append(
    pageHead("Inicio", "Resumen del taller",
      h("a", { class: "btn primary", href: "#nueva" }, "+ Nueva orden")),

    buscadorGlobal(),

    h("section", { class: "section-block" },
      h("h2", { class: "block-title" }, "Órdenes abiertas ", h("span", { class: "count" }, String(abiertas.length))),
      abiertas.length
        ? h("div", { class: "grid" }, abiertas.map((o) => orderCard(o, { cerrar: true })))
        : empty("No hay órdenes abiertas. Los vehículos que ingresen al taller aparecerán aquí.")),

    h("section", { class: "section-block" },
      h("h2", { class: "block-title" }, "Últimas 10 órdenes"),
      ultimas.length
        ? h("div", { class: "grid" }, ultimas.map((o) => orderCard(o)))
        : empty("Todavía no has creado órdenes de trabajo.",
            h("a", { class: "btn primary", href: "#nueva" }, "Crear la primera orden"))));
}

/** Busca por placa, nombre o cédula/RUC del cliente; cada resultado lleva al historial del vehículo. */
function buscadorGlobal() {
  const q = input({ type: "search", name: "q", placeholder: "Placa, nombre o cédula/RUC del cliente",
    "aria-label": "Buscar por placa, cliente o cédula", autocomplete: "off" });
  const results = h("div", { class: "search-results", "aria-live": "polite" });
  let primero = null;
  let seq = 0;

  async function buscar() {
    const texto = limpiarBusqueda(q.value);
    primero = null;
    if (texto.length < 2) return results.replaceChildren();
    const token = ++seq;
    results.replaceChildren(loading("Buscando…"));
    const placa = normPlaca(texto).replace(/[^A-Z0-9]/g, "");
    try {
      const [rv, rc] = await Promise.all([
        placa
          ? sb.from("vehiculos").select("id,placa,marca,modelo,clientes(nombre)").ilike("placa", `%${placa}%`).order("placa").limit(8)
          : { data: [], error: null },
        sb.from("clientes").select("id,nombre,cedula_ruc,vehiculos(id,placa,marca,modelo)")
          .or(`nombre.ilike."*${texto}*",cedula_ruc.ilike."*${texto}*"`).order("nombre").limit(8),
      ]);
      if (token !== seq) return;
      const vehiculos = must(rv);
      const clientes = must(rc);

      // Un resultado por vehículo; los clientes sin vehículos se listan aparte
      const filas = new Map();
      for (const v of vehiculos) filas.set(v.id, { ...v, cliente: v.clientes?.nombre });
      const sinVehiculo = [];
      for (const c of clientes) {
        if (!c.vehiculos?.length) sinVehiculo.push(c);
        for (const v of c.vehiculos || []) if (!filas.has(v.id)) filas.set(v.id, { ...v, cliente: c.nombre, cedula: c.cedula_ruc });
      }
      const lista = [...filas.values()];
      primero = lista[0] || null;
      if (!lista.length && !sinVehiculo.length) return results.replaceChildren(empty("No encontramos placas ni clientes con ese dato."));
      results.replaceChildren(
        ...lista.map((v) =>
          h("a", { class: "result", href: `#historial/${encodeURIComponent(v.placa)}` },
            h("span", { class: "plate" }, formatPlaca(v.placa)),
            h("span", { class: "result-main" }, h("b", {}, `${v.marca} ${v.modelo}`),
              h("span", { class: "muted" }, [v.cliente, v.cedula].filter(Boolean).join(" · "))),
            h("span", { class: "result-go", "aria-hidden": "true" }, "→"))),
        ...sinVehiculo.map((c) =>
          h("div", { class: "result disabled" },
            h("span", { class: "result-main" }, h("b", {}, c.nombre),
              h("span", { class: "muted" }, [c.cedula_ruc, "sin vehículos ni órdenes"].filter(Boolean).join(" · "))))));
    } catch (e) {
      if (token === seq) results.replaceChildren(errorBox(errMsg(e)));
    }
  }

  let t;
  q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(buscar, 300); });
  const form = h("form", { class: "card search-card", role: "search",
    onsubmit: async (ev) => {
      ev.preventDefault();
      clearTimeout(t);
      await buscar();
      if (primero) location.hash = `#historial/${encodeURIComponent(primero.placa)}`;
    } },
    h("label", { class: "field-label", for: "global-q" }, "Buscar en el taller"),
    h("div", { class: "row" }, q, h("button", { class: "btn primary", type: "submit" }, "Buscar")));
  q.id = "global-q";
  return h("section", { class: "section-block" }, form, results);
}
