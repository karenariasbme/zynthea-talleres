import { sb } from "../sb.js";
import { h, must, val, toast, errMsg, PLANES, PLANES_URL, diasRestantes, tieneEstandar, telWa, urlPublica } from "../util.js";
import { state } from "../state.js";
import { pageHead, field, input, asyncForm, userError, tallerLogo, bloqueoEstandar } from "../ui.js";

const TALLER_COLS = "*";
const LOGO_TIPOS = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const LOGO_MAX = 1024 * 1024; // 1 MB

/** Borra de la carpeta del taller todos los archivos excepto el logo vigente (incluye huérfanos de subidas fallidas). */
async function limpiarLogos(vigente) {
  const carpeta = state.taller.id;
  const { data, error } = await sb.storage.from("logos").list(carpeta, { limit: 100 });
  if (error) return; // la limpieza no debe impedir el cambio de logo
  const sobrantes = data.map((o) => `${carpeta}/${o.name}`).filter((ruta) => ruta !== vigente);
  if (sobrantes.length) await sb.storage.from("logos").remove(sobrantes);
}

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
      enlacesCard(),
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

  let busy = false;
  const error = (e) => { msg.textContent = e.userMessage || errMsg(e); msg.hidden = false; };
  const ocupado = (on) => { busy = on; subirLbl.classList.toggle("disabled", on); quitarBtn.disabled = on; fileIn.disabled = on; };

  fileIn.addEventListener("change", async () => {
    const file = fileIn.files[0];
    fileIn.value = "";
    if (!file || busy) return; // una subida a la vez
    msg.hidden = true;
    const ext = LOGO_TIPOS[file.type];
    if (!ext) return error(userError("Formato no permitido. Usa una imagen PNG, JPG o WEBP."));
    if (file.size > LOGO_MAX) return error(userError(`La imagen pesa ${(file.size / 1048576).toFixed(1)} MB. El máximo es 1 MB.`));

    const anterior = state.taller.logo_path;
    const ruta = `${state.taller.id}/logo-${Date.now()}.${ext}`; // timestamp: evita que el navegador muestre el logo viejo en caché
    // (al terminar se borra el anterior y cualquier otro archivo sobrante de la carpeta)
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
      await limpiarLogos(ruta);
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
    if (busy || !anterior || !confirm("¿Quitar el logo del taller? Se mostrarán las iniciales en su lugar.")) return;
    msg.hidden = true;
    ocupado(true);
    try {
      await guardarTaller({ logo_path: null });
      await limpiarLogos(null);
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

// ---------- e) Página de enlaces y reservas (Plan Estándar) ----------
const DIAS = [["1", "Lunes"], ["2", "Martes"], ["3", "Miércoles"], ["4", "Jueves"], ["5", "Viernes"], ["6", "Sábado"], ["7", "Domingo"]];

function enlacesCard() {
  const t = state.taller;
  if (!tieneEstandar(t)) {
    return bloqueoEstandar(t, "Página de enlaces y reservas",
      "Un solo enlace para tus redes con WhatsApp, ubicación y un formulario para que tus clientes reserven turno.");
  }
  const horario = t.horario || {};
  const filasHorario = DIAS.map(([k, nombre]) => {
    const r = horario[k];
    const abierto = h("input", { type: "checkbox", name: `abre_${k}`, checked: !!r });
    const de = input({ type: "time", name: `de_${k}`, value: r?.[0] || "08:00", disabled: !r, "aria-label": `${nombre} desde` });
    const a = input({ type: "time", name: `a_${k}`, value: r?.[1] || "17:00", disabled: !r, "aria-label": `${nombre} hasta` });
    abierto.addEventListener("change", () => { de.disabled = a.disabled = !abierto.checked; });
    return h("div", { class: "horario-fila" }, h("label", { class: "check" }, abierto, ` ${nombre}`), de, h("span", { class: "muted" }, "a"), a);
  });

  const enlaceBox = h("div");
  const pintarEnlace = () => {
    const tt = state.taller;
    enlaceBox.replaceChildren(...(tt.slug ? [h("div", { class: "msg ok stack-sm" },
      h("span", {}, "Tu enlace: ", h("b", { class: "url-text" }, urlPublica("enlaces.html", tt.slug))),
      h("div", { class: "actions" },
        h("a", { class: "btn small primary", href: urlPublica("enlaces.html", tt.slug), target: "_blank", rel: "noopener" }, "Abrir"),
        h("button", { class: "btn small ghost", type: "button", onclick: async () => {
          const u = urlPublica("enlaces.html", tt.slug);
          try { await navigator.clipboard.writeText(u); toast("Enlace copiado"); } catch { prompt("Copia el enlace:", u); }
        } }, "Copiar")))] : [h("p", { class: "note" }, "Elige el nombre corto de tu enlace y guarda para obtenerlo.")]));
  };
  pintarEnlace();

  const color = input({ type: "color", name: "color_marca", value: t.color_marca || "#C2410C", class: "input color-input" });
  return asyncForm({ class: "card stack" }, [
    h("h2", {}, "Página de enlaces y reservas"),
    h("p", { class: "note" }, "Un solo enlace para tus redes: WhatsApp, ubicación, TikTok y reserva de turno."),
    field("Nombre corto del enlace *", input({ name: "slug", required: true, maxlength: 40, value: t.slug ?? "", autocapitalize: "off",
      spellcheck: "false", placeholder: "mitaller" }), "Solo minúsculas, números y guiones (3 a 40). Si lo cambias, el enlace anterior deja de funcionar."),
    enlaceBox,
    field("WhatsApp", input({ name: "whatsapp", type: "tel", maxlength: 20, value: t.whatsapp ?? "", placeholder: "0991234567" })),
    field("Ubicación (enlace de Google Maps)", input({ name: "maps_url", type: "url", maxlength: 300, value: t.maps_url ?? "", placeholder: "https://maps.app.goo.gl/…" })),
    field("TikTok", input({ name: "tiktok_url", type: "url", maxlength: 300, value: t.tiktok_url ?? "", placeholder: "https://www.tiktok.com/@tutaller" }),
      "Si lo dejas vacío, el botón de TikTok no aparece."),
    field("Color de tu marca", color, "Se usa en los botones de tu página."),
    h("h3", {}, "Reservas de turno"),
    h("label", { class: "check" }, h("input", { type: "checkbox", name: "reservas_activas", checked: !!t.reservas_activas }),
      " Recibir reservas desde mi página"),
    h("div", { class: "horario" }, filasHorario),
    h("div", { class: "cols" },
      field("Duración de cada turno", h("select", { class: "input", name: "turno_minutos", value: String(t.turno_minutos ?? 60) },
        [15, 20, 30, 45, 60, 90, 120].map((m) => h("option", { value: String(m) }, m < 60 ? `${m} minutos` : m === 60 ? "1 hora" : `${m / 60} horas`)))),
      field("Vehículos por turno", input({ name: "turno_cupos", type: "number", min: 1, max: 10, value: t.turno_cupos ?? 1 }))),
    h("button", { class: "btn primary", type: "submit" }, "Guardar página y reservas"),
  ], async (fd) => {
    const slug = (val(fd, "slug") || "").toLowerCase();
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length < 3 || slug.length > 40)
      throw userError("El nombre corto solo puede tener minúsculas, números y guiones (3 a 40), sin espacios.");
    const wa = val(fd, "whatsapp");
    const whatsapp = wa ? telWa(wa) : null;
    if (wa && !whatsapp) throw userError("Escribe un WhatsApp válido, por ejemplo 0991234567.");
    const maps = val(fd, "maps_url");
    if (maps && !/^https:\/\//.test(maps)) throw userError("El enlace de ubicación debe empezar con https://");
    const tiktok = val(fd, "tiktok_url");
    if (tiktok && !/^https:\/\/(www\.)?tiktok\.com\//.test(tiktok)) throw userError("El enlace de TikTok debe empezar con https://www.tiktok.com/");
    const nuevoHorario = {};
    for (const [k, nombre] of DIAS) {
      if (!fd.get(`abre_${k}`)) continue;
      const de = fd.get(`de_${k}`), a = fd.get(`a_${k}`);
      if (!de || !a || de >= a) throw userError(`Revisa el horario del ${nombre.toLowerCase()}: la hora de cierre debe ser después de la de apertura.`);
      nuevoHorario[k] = [de, a];
    }
    const activas = !!fd.get("reservas_activas");
    if (activas && !Object.keys(nuevoHorario).length) throw userError("Marca al menos un día de atención para recibir reservas.");
    const cupos = Number(fd.get("turno_cupos"));
    if (!(cupos >= 1 && cupos <= 10)) throw userError("Los vehículos por turno deben estar entre 1 y 10.");
    try {
      await guardarTaller({ slug, whatsapp, maps_url: maps, tiktok_url: tiktok, color_marca: color.value,
        reservas_activas: activas, horario: nuevoHorario, turno_minutos: Number(fd.get("turno_minutos")), turno_cupos: cupos });
    } catch (e) {
      if (e.code === "23505") throw userError("Ese nombre corto ya lo usa otro taller. Elige otro.");
      throw e;
    }
    pintarEnlace();
    toast("Página de enlaces guardada");
  });
}
