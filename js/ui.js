import { h, errMsg, formatPlaca, fmtFecha } from "./util.js";

export const loading = (text = "Cargando…") =>
  h("div", { class: "state" }, h("span", { class: "spinner", "aria-hidden": "true" }), text);

export const empty = (text, action) => h("div", { class: "state empty" }, h("p", {}, text), action);

export const errorBox = (text) => h("div", { class: "state error", role: "alert" }, text);

export const pageHead = (title, sub, action) =>
  h("div", { class: "page-head" },
    h("div", {}, h("h1", {}, title), sub && h("p", { class: "sub" }, sub)),
    action);

/** Etiqueta + control de formulario. */
export const field = (label, control, hint) =>
  h("label", { class: "field" }, h("span", { class: "field-label" }, label), control, hint && h("small", {}, hint));

export const input = (props) => h("input", { class: "input", ...props });
export const textarea = (props) => h("textarea", { class: "input", rows: 3, ...props });

export const estadoBadge = (o) =>
  o.fecha_salida
    ? h("span", { class: "badge closed" }, "Entregada")
    : h("span", { class: "badge open" }, "Abierta");

/** Tarjeta de orden (datos de la vista historial_ordenes). */
export function orderCard(o, { cerrar = false } = {}) {
  const id = encodeURIComponent(o.id);
  return h("div", { class: "card ot-card" },
    h("a", { class: "ot-link", href: `#orden/${id}` },
      h("div", { class: "ot-top" },
        h("span", { class: "ot-code" }, o.codigo),
        estadoBadge(o)),
      h("div", { class: "ot-plate" },
        h("span", { class: "plate" }, formatPlaca(o.placa)),
        h("span", {}, `${o.marca} ${o.modelo}`)),
      h("div", { class: "ot-motivo" }, o.motivo),
      h("div", { class: "ot-meta" }, o.cliente_nombre, " · Ingreso ", fmtFecha(o.fecha_ingreso))),
    cerrar && !o.fecha_salida &&
      h("a", { class: "btn small primary ot-close", href: `#cerrar/${id}` }, "Cerrar orden"));
}

/**
 * Ventana con formulario. onSubmit recibe el FormData; si lanza un error,
 * se muestra el mensaje dentro de la ventana y no se cierra.
 */
export function openDialog(title, body, { submitLabel = "Guardar", onSubmit }) {
  const msg = h("p", { class: "msg error", role: "alert", hidden: true });
  const submit = h("button", { class: "btn primary", type: "submit" }, submitLabel);
  const form = h("form", { class: "dialog-form", novalidate: false },
    h("h2", {}, title), body, msg,
    h("div", { class: "actions" },
      h("button", { type: "button", class: "btn ghost", onclick: () => dlg.close() }, "Cancelar"),
      submit));
  const dlg = h("dialog", { class: "dlg" }, form);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    msg.hidden = true;
    submit.disabled = true;
    const label = submit.textContent;
    submit.textContent = "Guardando…";
    try {
      await onSubmit(new FormData(form));
      dlg.close();
    } catch (e) {
      msg.textContent = e.userMessage || errMsg(e);
      msg.hidden = false;
    } finally {
      submit.disabled = false;
      submit.textContent = label;
    }
  });
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

/** Error de validación con mensaje para el usuario. */
export function userError(text) {
  const e = new Error(text);
  e.userMessage = text;
  return e;
}

/** Formulario de envío con estado de carga y mensaje de error propio. */
export function asyncForm(props, children, onSubmit) {
  const msg = h("p", { class: "msg error", role: "alert", hidden: true });
  const form = h("form", props, children, msg);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const btn = form.querySelector("button[type=submit]");
    const label = btn?.textContent;
    msg.hidden = true;
    if (btn) { btn.disabled = true; btn.textContent = "Guardando…"; }
    try {
      await onSubmit(new FormData(form), form);
    } catch (e) {
      msg.textContent = e.userMessage || errMsg(e);
      msg.hidden = false;
      msg.scrollIntoView({ block: "nearest", behavior: "smooth" });
    } finally {
      if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = label; }
    }
  });
  return form;
}
