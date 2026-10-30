import { sb } from "../sb.js";
import { h, must, val, toast, errMsg, PLANES, PLANES_URL, diasRestantes } from "../util.js";
import { state } from "../state.js";
import { pageHead, field, input, asyncForm, userError, tallerLogo } from "../ui.js";

const TALLER_COLS = "id,nombre,plan,trial_ends_at,ruc,direccion,telefono,correo,logo_path";
const LOGO_TIPOS = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const LOGO_MAX = 1024 * 1024; // 1 MB

/** Actualiza columnas editables del taller y refresca la barra superior. */
async function guardarTaller(cambios) {
  const t = must(await sb.from("talleres").update(cambios).eq("id", state.taller.id).select(TALLER_COLS).single());
  state.taller = t;
  state.updateChrome();
  return t;
}

export async function render(box) {
  const { data: { user } } = await sb.auth.getUser();
  box.append(
    pageHead("Mi taller", "Datos de tu empresa, logo, plan y cuenta"),
    h("div", { class: "settings" },
      datosCard(),
      logoCard(),
      planCard(),
      cuentaCard(user)));
}

// ---------- a) Datos de la empresa ----------
function datosCard() {
  const t = state.taller;
  return asyncForm({ class: "card stack" }, [
    h("h2", {}, "Datos de la empresa"),
    h("p", { class: "note" }, "Aparecen en la barra superior y en el encabezado de cada orden impresa."),
    field("Nombre del taller *", input({ name: "nombre", required: true, maxlength: 120, value: t.nombre })),
    h("div", { class: "cols" },
      field("RUC", input({ name: "ruc", inputmode: "numeric", maxlength: 13, value: t.ruc ?? "" })),
      field("Teléfono", input({ name: "telefono", type: "tel", maxlength: 20, value: t.telefono ?? "" }))),
    field("Dirección", input({ name: "direccion", maxlength: 200, value: t.direccion ?? "" })),
    field("Correo", input({ name: "correo", type: "email", maxlength: 120, value: t.correo ?? "" })),
    h("button", { class: "btn primary", type: "submit" }, "Guardar datos"),
  ], async (fd) => {
    const nombre = val(fd, "nombre");
    if (!nombre) throw userError("Escribe el nombre del taller.");
    await guardarTaller({ nombre, ruc: val(fd, "ruc"), direccion: val(fd, "direccion"), telefono: val(fd, "telefono"), correo: val(fd, "correo") });
    toast("Datos del taller guardados");
  });
}

// ---------- b) Logo ----------
function logoCard() {
  const preview = h("div", { class: "logo-preview" });
  const msg = h("p", { class: "msg error", role: "alert", hidden: true });
  const fileIn = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", class: "sr-only", id: "logo-file" });
  const subirLbl = h("label", { class: "btn primary", for: "logo-file" });
  const quitarBtn = h("button", { class: "btn danger", type: "button" }, "Quitar logo");

  function pintar() {
    const t = state.taller;
    preview.replaceChildren(tallerLogo(t, "lg"),
      h("p", { class: "note" }, t.logo_path ? "Este es el logo actual." : "Sin logo: se muestran las iniciales del taller."));
    subirLbl.textContent = t.logo_path ? "Reemplazar logo" : "Subir logo";
    quitarBtn.hidden = !t.logo_path;
  }

  const error = (e) => { msg.textContent = e.userMessage || errMsg(e); msg.hidden = false; };
  const ocupado = (on) => { subirLbl.classList.toggle("disabled", on); quitarBtn.disabled = on; fileIn.disabled = on; };

  fileIn.addEventListener("change", async () => {
    const file = fileIn.files[0];
    fileIn.value = "";
    if (!file) return;
    msg.hidden = true;
    const ext = LOGO_TIPOS[file.type];
    if (!ext) return error(userError("Formato no permitido. Usa una imagen PNG, JPG o WEBP."));
    if (file.size > LOGO_MAX) return error(userError(`La imagen pesa ${(file.size / 1048576).toFixed(1)} MB. El máximo es 1 MB.`));

    const anterior = state.taller.logo_path;
    const ruta = `${state.taller.id}/logo-${Date.now()}.${ext}`; // timestamp: evita que el navegador muestre el logo viejo en caché
    ocupado(true);
    subirLbl.textContent = "Subiendo…";
    try {
      must(await sb.storage.from("logos").upload(ruta, file, { contentType: file.type, upsert: false }));
      try {
        await guardarTaller({ logo_path: ruta });
      } catch (e) {
        await sb.storage.from("logos").remove([ruta]); // no dejar archivos sin usar
        throw e;
      }
      if (anterior) await sb.storage.from("logos").remove([anterior]);
      toast(anterior ? "Logo reemplazado" : "Logo subido");
    } catch (e) {
      error(e);
    } finally {
      ocupado(false);
      pintar();
    }
  });

  quitarBtn.addEventListener("click", async () => {
    const anterior = state.taller.logo_path;
    if (!anterior || !confirm("¿Quitar el logo del taller? Se mostrarán las iniciales en su lugar.")) return;
    msg.hidden = true;
    ocupado(true);
    try {
      await guardarTaller({ logo_path: null });
      await sb.storage.from("logos").remove([anterior]);
      toast("Logo quitado");
    } catch (e) {
      error(e);
    } finally {
      ocupado(false);
      pintar();
    }
  });

  pintar();
  return h("div", { class: "card stack" },
    h("h2", {}, "Logo"),
    preview,
    h("p", { class: "note" }, "PNG, JPG o WEBP de hasta 1 MB. Mejor si es cuadrado o con fondo transparente."),
    fileIn,
    h("div", { class: "actions" }, subirLbl, quitarBtn),
    msg);
}

// ---------- d) Plan ----------
function planCard() {
  const t = state.taller;
  const demo = t.plan === "demo";
  const dias = demo ? diasRestantes(t) : 0;
  return h("div", { class: "card stack" },
    h("h2", {}, "Plan"),
    h("div", { class: "plan-row" },
      h("span", { class: "plan-name" }, PLANES[t.plan] || t.plan),
      demo && h("span", { class: "badge open" }, `Quedan ${dias} ${dias === 1 ? "día" : "días"}`)),
    demo
      ? [h("p", { class: "note" }, "Al terminar la demo tus datos quedan guardados; activa tu plan para seguir usándolos."),
         h("a", { class: "btn primary", href: PLANES_URL }, "Activar plan")]
      : h("p", { class: "note" }, "Tu plan está activo."));
}

// ---------- c) Mi cuenta ----------
function cuentaCard(user) {
  const form = asyncForm({ class: "stack" }, [
    h("h3", {}, "Cambiar contraseña"),
    field("Nueva contraseña", input({ name: "password", type: "password", autocomplete: "new-password", minlength: 8, required: true }),
      "Mínimo 8 caracteres."),
    field("Repite la nueva contraseña", input({ name: "password2", type: "password", autocomplete: "new-password", minlength: 8, required: true })),
    h("button", { class: "btn primary", type: "submit" }, "Cambiar contraseña"),
  ], async (fd, f) => {
    const p1 = fd.get("password");
    const p2 = fd.get("password2");
    if (p1.length < 8) throw userError("La contraseña debe tener al menos 8 caracteres.");
    if (p1 !== p2) throw userError("Las contraseñas no coinciden.");
    const { error } = await sb.auth.updateUser({ password: p1 });
    if (error) throw error;
    f.reset();
    toast("Contraseña actualizada");
  });

  return h("div", { class: "card stack" },
    h("h2", {}, "Mi cuenta"),
    h("div", { class: "dato" }, h("dt", {}, "Correo"), h("dd", { id: "cuenta-email" }, user?.email || "—")),
    form,
    h("button", { class: "btn ghost", type: "button", onclick: async () => {
      await sb.auth.signOut();
      location.replace("index.html");
    } }, "Cerrar sesión"));
}
