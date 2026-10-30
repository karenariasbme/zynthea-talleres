import { sb } from "../sb.js";
import { h, must, formatPlaca, errMsg } from "../util.js";
import { pageHead, orderCard, empty, input, loading, errorBox } from "../ui.js";
import { cargarIndice, buscarEnIndice } from "../buscar.js";

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

/** Busca por placa, nombre o cédula del cliente, marca, modelo o color; cada resultado lleva al historial del vehículo. */
function buscadorGlobal() {
  const q = input({ type: "search", name: "q", placeholder: "Placa, cliente, cédula, marca, modelo o color",
    "aria-label": "Buscar en el taller", autocomplete: "off" });
  const results = h("div", { class: "search-results", "aria-live": "polite" });
  let primero = null;
  let indice = null;
  let seq = 0;

  async function buscar() {
    const texto = q.value.trim();
    primero = null;
    if (texto.length < 2) return results.replaceChildren();
    const token = ++seq;
    try {
      if (!indice) {
        results.replaceChildren(loading("Buscando…"));
        indice = await cargarIndice();
      }
      if (token !== seq) return;
      const r = buscarEnIndice(indice, texto, 10);
      const sinVehiculo = r.clientes.filter((c) => !c.vehiculos.length);
      primero = r.vehiculos[0] || null;
      if (!r.vehiculos.length && !sinVehiculo.length) return results.replaceChildren(empty("No encontramos vehículos ni clientes con ese dato."));
      results.replaceChildren(
        ...r.vehiculos.map((v) =>
          h("a", { class: "result", href: `#historial/${encodeURIComponent(v.placa)}` },
            h("span", { class: "plate" }, formatPlaca(v.placa)),
            h("span", { class: "result-main" }, h("b", {}, [v.marca, v.modelo, v.anio, v.color].filter(Boolean).join(" · ")),
              h("span", { class: "muted" }, [v.cliente?.nombre, v.cliente?.cedula_ruc].filter(Boolean).join(" · "))),
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
