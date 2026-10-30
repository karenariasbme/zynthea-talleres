import { sb } from "../sb.js";
import { h, must, normPlaca, formatPlaca, fmtFecha, errMsg } from "../util.js";
import { pageHead, input, empty, loading, errorBox, estadoBadge } from "../ui.js";
import { limpiarBusqueda } from "./clientes.js";

export async function render(box, inicial) {
  const results = h("div", { class: "stack-lg" });
  const q = input({ type: "search", name: "q", placeholder: "Placa o nombre del cliente", required: true,
    "aria-label": "Buscar por placa o cliente", value: inicial ? formatPlaca(inicial) : "" });

  async function buscar() {
    const texto = limpiarBusqueda(q.value);
    if (!texto) return results.replaceChildren(empty("Escribe una placa o el nombre del cliente para ver su historial."));
    results.replaceChildren(loading("Buscando…"));
    const placa = normPlaca(texto).replace(/[^A-Z0-9]/g, "");
    const conds = [`cliente_nombre.ilike."*${texto}*"`];
    if (placa) conds.push(`placa.ilike."*${placa}*"`);
    try {
      const data = must(await sb.from("historial_ordenes").select("*").or(conds.join(","))
        .order("fecha_ingreso", { ascending: false }).limit(500));
      pintar(results, data);
    } catch (e) {
      results.replaceChildren(errorBox(errMsg(e)));
    }
  }

  const form = h("form", { class: "toolbar row", onsubmit: (ev) => { ev.preventDefault(); buscar(); } },
    q, h("button", { class: "btn primary", type: "submit" }, "Buscar"));

  box.append(pageHead("Historial", "Todas las órdenes de un vehículo o de un cliente"), form, results);
  if (inicial) await buscar();
  else results.replaceChildren(empty("Escribe una placa o el nombre del cliente para ver su historial."));
}

/** Agrupa las órdenes por vehículo (ya vienen ordenadas por fecha, de la más reciente a la más antigua). */
function pintar(box, ordenes) {
  if (!ordenes.length) return box.replaceChildren(empty("No hay órdenes que coincidan con la búsqueda."));
  const grupos = new Map();
  for (const o of ordenes) {
    if (!grupos.has(o.vehiculo_id)) grupos.set(o.vehiculo_id, []);
    grupos.get(o.vehiculo_id).push(o);
  }
  box.replaceChildren(...[...grupos.values()].map((lista) => {
    const v = lista[0];
    return h("section", { class: "card hist" },
      h("header", { class: "hist-head" },
        h("span", { class: "plate big" }, formatPlaca(v.placa)),
        h("div", {},
          h("b", {}, [v.marca, v.modelo, v.anio].filter(Boolean).join(" ")),
          h("div", { class: "muted" }, [v.color, v.cliente_nombre, v.cliente_telefono].filter(Boolean).join(" · ")),
          h("div", { class: "muted" }, `${lista.length} ${lista.length === 1 ? "orden" : "órdenes"}`))),
      lista.map((o, i) => detalle(o, i === 0)));
  }));
}

const dato = (label, value) =>
  h("div", { class: "dato" }, h("dt", {}, label), h("dd", {}, value == null || value === "" ? "—" : value));

function detalle(o, abierto) {
  const id = encodeURIComponent(o.id);
  return h("details", { class: "hist-item", open: abierto },
    h("summary", {},
      h("span", { class: "ot-code" }, o.codigo),
      h("span", { class: "hist-date" }, fmtFecha(o.fecha_ingreso)),
      estadoBadge(o),
      h("span", { class: "hist-motivo" }, o.motivo)),
    h("dl", { class: "hist-body" },
      dato("Tipo", o.tipo === "preventivo" ? "Preventivo" : "Correctivo"),
      dato("Motivo", o.motivo),
      dato("Descripción", o.descripcion),
      dato("Ingreso", fmtFecha(o.fecha_ingreso)),
      dato("Cómo llegó", o.observacion_ingreso),
      dato("Salida", o.fecha_salida ? fmtFecha(o.fecha_salida) : "Pendiente"),
      dato("Cómo se va", o.observacion_salida)),
    h("div", { class: "actions" },
      h("a", { class: "btn small ghost", href: `#orden/${id}` }, "Ver / imprimir"),
      !o.fecha_salida && h("a", { class: "btn small primary", href: `#cerrar/${id}` }, "Cerrar orden")));
}
