// Mano de obra y repuestos (cantidad × precio), IVA y total. Lo usan las órdenes y los presupuestos.
// El costo unitario es opcional e interno: sirve para la ganancia y nunca sale en el documento del cliente.
import { sb } from "./sb.js";
import { h, must, val, num, usd, toast, errMsg } from "./util.js";
import { field, input, openDialog, userError, loading, errorBox } from "./ui.js";
import { TIPO_ITEM } from "./documento.js";

const COLS = "id,tipo,descripcion,cantidad,precio_unitario,costo_unitario,subtotal,created_at";

/**
 * cfg = { tabla: "orden_items" | "presupuesto_items", fk: "orden_id" | "presupuesto_id", id,
 *         padre: "ordenes_trabajo" | "presupuestos", vistaTotales, idTotales, conCostos, onCambio(datos) }
 * Devuelve { el, cargar } — cargar() vuelve a leer y pintar (y avisa con onCambio).
 */
export function itemsEditor(cfg) {
  const el = h("section", { class: "card stack items-card" }, loading());

  async function leer() {
    const [ri, rt, rp, rc] = await Promise.all([
      sb.from(cfg.tabla).select(COLS).eq(cfg.fk, cfg.id).order("created_at"),
      sb.from(cfg.vistaTotales).select("*").eq(cfg.idTotales, cfg.id).maybeSingle(),
      sb.from(cfg.padre).select("aplica_iva,iva_porcentaje").eq("id", cfg.id).single(),
      cfg.conCostos ? sb.from("ordenes_costos").select("costo,repuestos_sin_costo").eq("orden_id", cfg.id).maybeSingle()
                    : Promise.resolve({ data: null, error: null }),
    ]);
    return { items: must(ri), totales: must(rt), iva: must(rp), costos: must(rc) };
  }

  async function cargar() {
    try {
      const d = await leer();
      pintar(d);
      cfg.onCambio?.(d);
    } catch (e) {
      el.replaceChildren(errorBox(errMsg(e)));
    }
  }

  function pintar({ items, totales, iva, costos }) {
    const t = totales || {};
    const filas = items.length
      ? h("ul", { class: "item-list" }, items.map((i) => h("li", { class: "item-row" },
          h("div", { class: "item-row-main" },
            h("b", {}, i.descripcion),
            h("span", { class: "muted" },
              `${TIPO_ITEM[i.tipo]} · ${Number(i.cantidad).toLocaleString("es-EC")} × ${usd(i.precio_unitario)}`,
              i.costo_unitario != null ? ` · costo ${usd(i.costo_unitario)} c/u` : "")),
          h("span", { class: "item-row-total" }, usd(i.subtotal)),
          h("div", { class: "item-actions" },
            h("button", { class: "btn small ghost", type: "button", onclick: () => dialogo(i) }, "Editar"),
            h("button", { class: "btn small danger", type: "button", onclick: () => borrar(i) }, "Quitar")))))
      : h("p", { class: "note" }, "Todavía no hay mano de obra ni repuestos. Agrega el primero.");

    const ivaCheck = h("input", { type: "checkbox", checked: iva.aplica_iva });
    const ivaPct = input({ type: "number", min: 0, max: 100, step: "0.01", value: iva.iva_porcentaje, class: "input iva-pct",
      "aria-label": "Porcentaje de IVA", disabled: !iva.aplica_iva });
    const guardarIva = async () => {
      const pct = Number(ivaPct.value);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) { toast("El IVA debe estar entre 0 y 100 %.", "error"); return; }
      try {
        must(await sb.from(cfg.padre).update({ aplica_iva: ivaCheck.checked, iva_porcentaje: pct }).eq("id", cfg.id).select("id").single());
        await cargar();
      } catch (e) { toast(errMsg(e), "error"); }
    };
    ivaCheck.addEventListener("change", () => { ivaPct.disabled = !ivaCheck.checked; guardarIva(); });
    ivaPct.addEventListener("change", guardarIva);

    const linea = (label, valor, cls) => h("div", { class: `tot-line ${cls || ""}` }, h("span", {}, label), h("b", {}, usd(valor)));

    let ganancia = null;
    if (cfg.conCostos && items.length) {
      const venta = Number(t.subtotal) || 0;
      ganancia = costos && costos.repuestos_sin_costo === 0
        ? h("p", { class: "ganancia ok" }, "Ganancia: ", h("b", {}, usd(venta - Number(costos.costo))),
            h("span", { class: "muted" }, ` (venta sin IVA ${usd(venta)} − costo ${usd(costos.costo)})`))
        : h("p", { class: "ganancia" }, "Solo ingresos: ",
            h("span", { class: "muted" }, `${costos?.repuestos_sin_costo || 0} repuesto(s) sin costo. Agrega el costo para ver la ganancia.`));
    }

    el.replaceChildren(
      h("div", { class: "items-head" },
        h("h2", {}, "Mano de obra y repuestos"),
        h("button", { class: "btn primary small no-print", type: "button", onclick: () => dialogo(null) }, "+ Agregar")),
      filas,
      h("div", { class: "totales" },
        linea("Mano de obra", t.total_mano_obra),
        linea("Repuestos", t.total_repuestos),
        Number(t.total_otros) > 0 && linea("Otros", t.total_otros),
        linea("Subtotal", t.subtotal),
        h("div", { class: "tot-line iva-line" },
          h("label", { class: "iva-toggle" }, ivaCheck, " IVA"), ivaPct, h("span", { class: "muted" }, "%"),
          h("b", {}, usd(t.iva))),
        linea("Total", t.total, "tot-final")),
      ganancia ?? "");
  }

  async function borrar(i) {
    if (!confirm(`¿Quitar "${i.descripcion}"?`)) return;
    try {
      must(await sb.from(cfg.tabla).delete().eq("id", i.id).select("id").single());
      toast("Ítem quitado");
      await cargar();
    } catch (e) { toast(errMsg(e), "error"); }
  }

  function dialogo(i) {
    const tipo = h("select", { class: "input", name: "tipo", required: true, value: i?.tipo || "mano_obra" },
      Object.entries(TIPO_ITEM).map(([k, n]) => h("option", { value: k }, n)));
    const body = h("div", { class: "stack" },
      field("Tipo *", tipo),
      field("Descripción *", input({ name: "descripcion", required: true, maxlength: 300, value: i?.descripcion ?? "",
        placeholder: "Ej.: cambio de pastillas delanteras" })),
      h("div", { class: "cols" },
        field("Cantidad *", input({ name: "cantidad", required: true, inputmode: "decimal", value: i?.cantidad ?? 1 })),
        field("Precio unitario (USD) *", input({ name: "precio_unitario", required: true, inputmode: "decimal",
          value: i?.precio_unitario ?? "", placeholder: "0,00" }))),
      field("Costo unitario (USD)", input({ name: "costo_unitario", inputmode: "decimal", value: i?.costo_unitario ?? "",
        placeholder: "Opcional" }), "Lo que te costó. Es interno: el cliente no lo ve. Sirve para calcular tu ganancia."));
    openDialog(i ? "Editar ítem" : "Agregar ítem", body, {
      submitLabel: i ? "Guardar" : "Agregar",
      onSubmit: async (fd) => {
        const datos = {
          tipo: fd.get("tipo"),
          descripcion: val(fd, "descripcion"),
          cantidad: num(fd, "cantidad"),
          precio_unitario: num(fd, "precio_unitario"),
          costo_unitario: num(fd, "costo_unitario"),
        };
        if (!datos.descripcion) throw userError("Escribe la descripción.");
        if (!(datos.cantidad > 0)) throw userError("La cantidad debe ser mayor que 0.");
        if (!(datos.precio_unitario >= 0)) throw userError("Escribe un precio válido (0 o más).");
        if (Number.isNaN(datos.costo_unitario) || datos.costo_unitario < 0) throw userError("El costo debe ser un número de 0 o más, o déjalo vacío.");
        if (i) must(await sb.from(cfg.tabla).update(datos).eq("id", i.id).select("id").single());
        else must(await sb.from(cfg.tabla).insert({ ...datos, [cfg.fk]: cfg.id }).select("id").single());
        toast(i ? "Ítem actualizado" : "Ítem agregado");
        await cargar();
      },
    });
  }

  return { el, cargar };
}
