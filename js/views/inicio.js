import { sb } from "../sb.js";
import { h, must } from "../util.js";
import { pageHead, orderCard, empty } from "../ui.js";

export async function render(box) {
  const [ra, ru] = await Promise.all([
    sb.from("historial_ordenes").select("*").is("fecha_salida", null).order("fecha_ingreso", { ascending: false }),
    sb.from("historial_ordenes").select("*").order("numero", { ascending: false }).limit(10),
  ]);
  const abiertas = must(ra);
  const ultimas = must(ru);

  box.append(
    pageHead("Inicio", "Resumen del taller",
      h("a", { class: "btn primary", href: "#nueva" }, "+ Nueva orden")),

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
