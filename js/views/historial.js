import { sb } from "../sb.js";
import { h, must, formatPlaca, fmtFecha, errMsg, parecePlaca } from "../util.js";
import { pageHead, input, empty, loading, errorBox, estadoBadge } from "../ui.js";
import { cargarIndice, buscarEnIndice } from "../buscar.js";

const AYUDA = "Busca por placa, nombre o cédula del cliente, marca, modelo o color.";

export async function render(box, inicial) {
  const results = h("div", { class: "stack-lg" });
  const q = input({ type: "search", name: "q", placeholder: "Placa, cliente, cédula, marca, modelo o color", required: true,
    "aria-label": "Buscar en el historial", value: parecePlaca(inicial) ? formatPlaca(inicial) : inicial || "" });
  let indice = null;

  async function buscar() {
    const texto = q.value.trim();
    if (!texto) return results.replaceChildren(empty(AYUDA));
    results.replaceChildren(loading("Buscando…"));
    try {
      indice ??= await cargarIndice();
      // Vehículos que coinciden (por placa, marca, modelo, color o por su dueño) → sus órdenes
      const ids = buscarEnIndice(indice, texto, 200).vehiculos.map((v) => v.id);
      if (!ids.length) return results.replaceChildren(empty("No hay vehículos ni clientes que coincidan con la búsqueda."));
      const data = must(await sb.from("historial_ordenes").select("*").in("vehiculo_id", ids)
        .order("fecha_ingreso", { ascending: false }).order("numero", { ascending: false }).limit(500));
      pintar(results, data);
    } catch (e) {
      results.replaceChildren(errorBox(errMsg(e)));
    }
  }

  const form = h("form", { class: "toolbar row", onsubmit: (ev) => { ev.preventDefault(); buscar(); } },
    q, h("button", { class: "btn primary", type: "submit" }, "Buscar"));

  box.append(pageHead("Historial", "Todas las órdenes de un vehículo o de un cliente"), form, results);
  if (inicial) await buscar();
  else results.replaceChildren(empty(AYUDA));
}

/** Agrupa las órdenes por vehículo (ya vienen ordenadas de la más reciente a la más antigua). */
function pintar(box, ordenes) {
  if (!ordenes.length) return box.replaceChildren(empty("Los vehículos encontrados todavía no tienen órdenes."));
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
      dato("Cómo se va", o.observacion_salida),
      dato("Observaciones", o.observaciones)),
    h("div", { class: "actions" },
      h("a", { class: "btn small ghost", href: `#orden/${id}` }, "Ver / imprimir"),
      h("a", { class: "btn small ghost", href: `#editar/${id}` }, "Editar"),
      !o.fecha_salida && h("a", { class: "btn small primary", href: `#cerrar/${id}` }, "Cerrar orden")));
}
