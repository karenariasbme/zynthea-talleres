// Página de enlaces del taller (enlaces.html?t=<slug>): WhatsApp, ubicación, TikTok y reserva de turno.
// Sin sesión. Solo usa taller_publico, horarios_disponibles y reservar_turno (SECURITY DEFINER en la base):
// nunca lee reservas ajenas.
import { sb } from "../sb.js";
import { h, telWa, TZ, hoyLocal } from "../util.js";
import { logoUrl, iniciales } from "../ui.js";

const slug = (new URLSearchParams(location.search).get("t") || "").toLowerCase();
const raiz = document.getElementById("pagina");
const DIAS = { 1: "Lunes", 2: "Martes", 3: "Miércoles", 4: "Jueves", 5: "Viernes", 6: "Sábado", 7: "Domingo" };
const fmtDia = new Intl.DateTimeFormat("es-EC", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
const fmtHora = new Intl.DateTimeFormat("es-EC", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });

const ICONOS = {
  reservar: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M9 15l2 2 4-4"/></svg>',
  whatsapp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l1.3-4A8 8 0 1 1 8 18.7z"/><path d="M9 8.8c0 3 2.6 6.1 6 6.3l1-1.3-1.8-1-.9.8c-1-.4-2-1.4-2.4-2.4l.8-.9-1-1.8z"/></svg>',
  ubicacion: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  tiktok: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5"/><path d="M14 3c.5 2.6 2.3 4.3 5 4.5"/></svg>',
};
const icono = (n) => { const s = h("span", { class: "lk-ico" }); s.innerHTML = ICONOS[n]; return s; }; // SVG fijo, no datos del usuario

/** Texto blanco o negro según el color de marca (contraste). */
function tintaPara(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return "#fff";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (1.05) / (L + 0.05) >= (L + 0.05) / 0.05 ? "#fff" : "#111";
}

function noDisponible() {
  document.title = "Página no disponible";
  raiz.replaceChildren(h("div", { class: "lk-card lk-vacio" },
    h("h1", {}, "Página no disponible"),
    h("p", {}, "Este enlace no existe o el taller no lo tiene activo.")));
}

async function cargar() {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return noDisponible();
  const { data: t, error } = await sb.rpc("taller_publico", { p_slug: slug });
  if (error) {
    raiz.replaceChildren(h("div", { class: "lk-card lk-vacio" }, h("p", {}, "No se pudo cargar la página. Revisa tu conexión."),
      h("button", { class: "lk-btn", type: "button", onclick: () => location.reload() }, "Reintentar")));
    return;
  }
  if (!t) return noDisponible();

  document.title = t.nombre;
  if (t.color_marca) {
    document.documentElement.style.setProperty("--marca", t.color_marca);
    document.documentElement.style.setProperty("--marca-tinta", tintaPara(t.color_marca));
  }
  const logo = logoUrl(t.logo_path);
  const wa = telWa(t.whatsapp);

  const botones = [];
  if (t.reservas) botones.push(h("a", { class: "lk-btn principal", href: "#reservar" }, icono("reservar"), "Reservar turno"));
  if (wa) botones.push(h("a", { class: "lk-btn", href: `https://wa.me/${wa}?text=${encodeURIComponent(`Hola ${t.nombre}, quisiera información.`)}`,
    target: "_blank", rel: "noopener" }, icono("whatsapp"), "WhatsApp"));
  if (t.maps_url) botones.push(h("a", { class: "lk-btn", href: t.maps_url, target: "_blank", rel: "noopener" }, icono("ubicacion"), "Ubicación"));
  if (t.tiktok_url) botones.push(h("a", { class: "lk-btn", href: t.tiktok_url, target: "_blank", rel: "noopener" }, icono("tiktok"), "TikTok"));

  raiz.replaceChildren(
    h("header", { class: "lk-head" },
      logo ? h("img", { class: "lk-logo", src: logo, alt: `Logo de ${t.nombre}` })
           : h("span", { class: "lk-logo lk-iniciales", "aria-hidden": "true" }, iniciales(t.nombre)),
      h("h1", {}, t.nombre),
      t.direccion && h("p", { class: "lk-dir" }, t.direccion)),
    h("nav", { class: "lk-botones", "aria-label": "Enlaces" }, botones),
    t.reservas ? formularioReserva(t, wa) : "",
    h("footer", { class: "lk-pie" }, "Desarrollado por ",
      h("a", { href: "https://karenariasbme.github.io/KarenArias/", target: "_blank", rel: "noopener" }, "Zynthea Solutions")));
}

function formularioReserva(t, wa) {
  const hoy = hoyLocal();
  const max = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
  const fecha = h("input", { class: "lk-input", type: "date", name: "fecha", min: hoy, max, required: true, "aria-label": "Fecha" });
  const horas = h("div", { class: "lk-horas", role: "radiogroup", "aria-label": "Hora" });
  const msg = h("p", { class: "lk-msg", role: "alert", hidden: true });
  let elegida = null;

  const horario = Object.entries(t.horario || {}).sort(([a], [b]) => a - b)
    .map(([d, [de, a]]) => h("li", {}, h("b", {}, DIAS[d]), ` ${de} – ${a}`));

  async function cargarHoras() {
    elegida = null;
    msg.hidden = true;
    if (!fecha.value) return horas.replaceChildren();
    horas.replaceChildren(h("p", { class: "lk-nota" }, "Buscando horarios…"));
    const { data, error } = await sb.rpc("horarios_disponibles", { p_slug: slug, p_fecha: fecha.value });
    if (error) return horas.replaceChildren(h("p", { class: "lk-nota" }, "No se pudieron cargar los horarios. Inténtalo de nuevo."));
    if (!data?.length) return horas.replaceChildren(h("p", { class: "lk-nota" }, "No hay horarios disponibles ese día. Prueba con otra fecha."));
    horas.replaceChildren(...data.map((iso) => {
      const b = h("button", { class: "lk-hora", type: "button", role: "radio", "aria-checked": "false" }, fmtHora.format(new Date(iso)));
      b.addEventListener("click", () => {
        elegida = iso;
        for (const x of horas.children) x.setAttribute("aria-checked", String(x === b));
      });
      return b;
    }));
  }
  fecha.addEventListener("change", cargarHoras);

  const form = h("form", { class: "lk-form", novalidate: true },
    h("label", { class: "lk-campo" }, h("span", {}, "Fecha *"), fecha),
    h("div", { class: "lk-campo" }, h("span", {}, "Hora *"), horas),
    h("label", { class: "lk-campo" }, h("span", {}, "Tu nombre *"),
      h("input", { class: "lk-input", name: "nombre", required: true, maxlength: 120, autocomplete: "name" })),
    h("label", { class: "lk-campo" }, h("span", {}, "Teléfono / WhatsApp *"),
      h("input", { class: "lk-input", name: "telefono", type: "tel", required: true, maxlength: 20, autocomplete: "tel", placeholder: "0991234567" })),
    h("label", { class: "lk-campo" }, h("span", {}, "Placa"),
      h("input", { class: "lk-input", name: "placa", maxlength: 10, autocapitalize: "characters", placeholder: "ABC-1234" })),
    h("label", { class: "lk-campo" }, h("span", {}, "¿Qué necesitas?"),
      h("textarea", { class: "lk-input", name: "motivo", rows: 3, maxlength: 300, placeholder: "Ej.: cambio de aceite, revisión de frenos" })),
    msg,
    h("button", { class: "lk-btn principal", type: "submit" }, "Reservar"));

  const caja = h("section", { class: "lk-card", id: "reservar" },
    h("h2", {}, "Reservar turno"),
    horario.length ? h("ul", { class: "lk-horario" }, horario) : null,
    form);

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    msg.hidden = true;
    const fd = new FormData(form);
    const nombre = (fd.get("nombre") || "").trim();
    const tel = (fd.get("telefono") || "").replace(/\D/g, "");
    const error = (t) => { msg.textContent = t; msg.hidden = false; };
    if (!fecha.value) return error("Elige una fecha.");
    if (!elegida) return error("Elige una hora.");
    if (nombre.length < 2) return error("Escribe tu nombre.");
    if (!/^\d{9,15}$/.test(tel)) return error("Escribe un teléfono válido, por ejemplo 0991234567.");
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    btn.textContent = "Reservando…";
    const { data, error: e } = await sb.rpc("reservar_turno", {
      p_slug: slug, p_fecha_hora: elegida, p_nombre: nombre, p_telefono: tel,
      p_placa: (fd.get("placa") || "").trim() || null, p_motivo: (fd.get("motivo") || "").trim() || null,
    });
    btn.disabled = false;
    btn.textContent = "Reservar";
    if (e) {
      error(["22023", "P0002"].includes(e.code) ? e.message : "No se pudo reservar. Revisa tu conexión e inténtalo de nuevo.");
      if (/lleno|horario/i.test(e.message || "")) cargarHoras();
      return;
    }
    const cuando = `${fmtDia.format(new Date(data.fecha_hora))} a las ${fmtHora.format(new Date(data.fecha_hora))}`;
    caja.replaceChildren(
      h("h2", {}, "¡Turno reservado!"),
      h("p", { class: "lk-ok" }, `${data.taller} recibió tu reserva para el ${cuando}. Te confirmarán por WhatsApp.`),
      wa && h("a", { class: "lk-btn principal", target: "_blank", rel: "noopener",
        href: `https://wa.me/${wa}?text=${encodeURIComponent(`Hola, acabo de reservar un turno para el ${cuando} a nombre de ${nombre}.`)}` },
        icono("whatsapp"), "Avisar por WhatsApp"));
    caja.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  return caja;
}

cargar();
