// Vista de la página de enlaces del taller. Solo pinta: los datos y las llamadas a la base llegan por `api`
// (así se puede previsualizar con datos de ejemplo). Todo el texto del taller va con nodos de texto, nunca innerHTML;
// el único innerHTML es el de los íconos SVG fijos de este archivo.
import { h, telWa, TZ } from "../util.js";

// ---------- Color de marca → paleta con contraste AA ----------
const hexARgb = (hex) => [0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16));
const rgbAHex = (rgb) => "#" + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
const lum = (hex) => {
  const [r, g, b] = hexARgb(hex).map((v) => v / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contraste = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const mezclar = (a, b, t) => rgbAHex(hexARgb(a).map((v, i) => v + (hexARgb(b)[i] - v) * t));

/** Paleta: marca, versión oscura, tinta sobre marca (AA ≥ 4.5), fondo con tinte y color de acento legible sobre blanco. */
export function paleta(colorMarca) {
  const marca = /^#[0-9a-f]{6}$/i.test(colorMarca || "") ? colorMarca : "#C2410C";
  const OSCURO = "#14161A", BLANCO = "#FFFFFF";
  // Relleno de botones: la marca tal cual si blanco u oscuro alcanzan AA; si no, se oscurece hasta lograrlo
  let relleno = marca;
  let tinta = contraste(marca, BLANCO) >= contraste(marca, OSCURO) ? BLANCO : OSCURO;
  for (let t = 0.08; contraste(relleno, tinta) < 4.5 && t <= 0.8; t += 0.08) {
    relleno = mezclar(marca, "#000000", t);
    tinta = contraste(relleno, BLANCO) >= contraste(relleno, OSCURO) ? BLANCO : OSCURO;
  }
  // Acento sobre blanco (textos pequeños, íconos y anillos): oscurecer hasta AA 4.5:1
  let acento = marca;
  for (let t = 0.06; contraste(acento, BLANCO) < 4.5 && t <= 0.9; t += 0.06) acento = mezclar(marca, "#000000", t);
  return {
    "--marca": relleno,
    "--marca-tinta": tinta,
    "--marca-oscura": mezclar(marca, "#000000", 0.55),
    "--marca-media": mezclar(marca, "#000000", 0.2),
    "--acento": acento,
    "--fondo": mezclar(marca, "#F4F5F7", 0.94),
    "--marca-suave": mezclar(marca, "#FFFFFF", 0.88),
  };
}

// ---------- Íconos (SVG fijos) ----------
const ICONOS = {
  // Calendario con llave
  reservar: '<path d="M20 11.5V6.5H4v13a1.5 1.5 0 0 0 1.5 1.5H11"/><path d="M4 10.5h16M8.5 3.5v4M15.5 3.5v4"/>'
    + '<g transform="translate(12 12) scale(.5)"><path vector-effect="non-scaling-stroke" d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/></g>',
  // Llave con engranaje (título de la sección de reserva)
  taller: '<circle cx="7" cy="7" r="2.2"/><path d="M7 2.8v1.3M7 9.9v1.3M2.8 7h1.3M9.9 7h1.3M4 4l.9.9M9.1 9.1l.9.9M4 10l.9-.9M9.1 4.9l.9-.9"/>'
    + '<g transform="translate(5.5 5.5) scale(.78)"><path vector-effect="non-scaling-stroke" d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/></g>',
  // Silueta de auto en línea (pie)
  auto: '<path d="M3 17.5h3.2M12.8 17.5h18.4M37.8 17.5h3.2M3 17.5v-3.6l5.6-1.3 6.2-5h15.6l7 5 4.4.9 1.2 4"/><path d="M15.6 12.4h20.2"/>'
    + '<circle cx="9.5" cy="17.5" r="3.3"/><circle cx="34.5" cy="17.5" r="3.3"/>',
  whatsapp: '<path d="M4.5 19.5l1.2-3.9A7.6 7.6 0 1 1 8.6 18.4z"/><path d="M9.3 8.9c0 2.9 2.5 5.8 5.6 6l.9-1.2-1.7-1-.8.7c-1-.4-1.9-1.3-2.3-2.3l.7-.8-.9-1.7z"/>',
  ubicacion: '<path d="M12 21s-6.5-5.8-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.2 12 21 12 21z"/><circle cx="12" cy="10" r="2.4"/>',
  tiktok: '<path d="M14 3.5v11a3.5 3.5 0 1 1-3.5-3.5"/><path d="M14 3.5c.5 2.6 2.3 4.3 5 4.5"/>',
  flecha: '<path d="M9 5l7 7-7 7"/>',
  check: '<circle cx="12" cy="12" r="9.5"/><path d="M7.5 12.3l3 3 6-6.3"/>',
  reloj: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  pin: '<path d="M12 20s-5.5-5-5.5-9.3a5.5 5.5 0 0 1 11 0C17.5 15 12 20 12 20z"/><circle cx="12" cy="10.6" r="1.9"/>',
};
function icono(nombre, cls = "") {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", nombre === "auto" ? "0 0 46 24" : "0 0 24 24");
  s.setAttribute("aria-hidden", "true");
  if (cls) s.setAttribute("class", cls);
  s.innerHTML = ICONOS[nombre];   // SVG fijo de este archivo, sin datos del usuario
  return s;
}

// ---------- Horario (hora de Ecuador) ----------
const DIAS = { 1: "Lunes", 2: "Martes", 3: "Miércoles", 4: "Jueves", 5: "Viernes", 6: "Sábado", 7: "Domingo" };
const DIAS_CORTOS = { 1: "Lun", 2: "Mar", 3: "Mié", 4: "Jue", 5: "Vie", 6: "Sáb", 7: "Dom" };
/** Día ISO (1 = lunes) y hora "HH:MM" en Ecuador para una fecha. */
function ahoraEc(fecha = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(fecha).map((x) => [x.type, x.value]));
  const dia = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[p.weekday];
  return { dia, hora: `${p.hour === "24" ? "00" : p.hour}:${p.minute}` };
}

/** "Abierto ahora · cierra 17:00" o "Cerrado · abre lunes 08:00". */
export function estadoHorario(horario, fecha = new Date()) {
  const hz = horario || {};
  if (!Object.keys(hz).length) return null;
  const { dia, hora } = ahoraEc(fecha);
  const hoy = hz[dia];
  if (hoy && hora >= hoy[0] && hora < hoy[1]) return { abierto: true, texto: `Abierto ahora · cierra ${hoy[1]}` };
  if (hoy && hora < hoy[0]) return { abierto: false, texto: `Cerrado · abre hoy ${hoy[0]}` };
  for (let i = 1; i <= 7; i++) {
    const d = ((dia - 1 + i) % 7) + 1;
    if (hz[d]) return { abierto: false, texto: `Cerrado · abre ${i === 1 ? "mañana" : DIAS[d].toLowerCase()} ${hz[d][0]}` };
  }
  return null;
}

/** 593980451896 → +593 98 045 1896 */
export function formatoTel(digitos) {
  const m = /^593(\d{2})(\d{3})(\d{4})$/.exec(digitos || "");
  return m ? `+593 ${m[1]} ${m[2]} ${m[3]}` : digitos ? `+${digitos}` : "";
}

/** Color de fondo del logo leyendo sus 4 esquinas con canvas; null si es transparente, si varían o si falla (CORS). */
function colorDeFondo(img) {
  try {
    const n = 48;
    const c = document.createElement("canvas");
    c.width = n; c.height = n;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0, n, n);
    const zona = (x, y) => {   // promedio de 3×3 píxeles en cada esquina
      const d = g.getImageData(x, y, 3, 3).data;
      const s = [0, 0, 0, 0];
      for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 4; k++) s[k] += d[i + k];
      return s.map((v) => v / 9);
    };
    const esquinas = [[0, 0], [n - 3, 0], [0, n - 3], [n - 3, n - 3]].map(([x, y]) => zona(x, y));
    if (esquinas.some((p) => p[3] < 245)) return null;                       // fondo transparente
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const brillo = (p) => (p[0] + p[1] + p[2]) / 3;
    const promedio = (ps) => [0, 1, 2].map((k) => Math.round(ps.reduce((a, p) => a + p[k], 0) / ps.length));
    let parecidas = true;
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) if (dist(esquinas[i], esquinas[j]) > 36) parecidas = false;
    if (parecidas) return `rgb(${promedio(esquinas).join(",")})`;
    // Fondo con textura o degradado, pero todo oscuro (o todo muy claro): se usa el tono del medio de las esquinas
    const oscuro = esquinas.every((p) => brillo(p) < 80);
    const claro = esquinas.every((p) => brillo(p) > 205);
    if (!oscuro && !claro) return null;   // esquinas de colores distintos: círculo blanco
    const orden = [...esquinas].sort((a, b) => brillo(a) - brillo(b));
    return `rgb(${promedio([orden[1], orden[2]]).join(",")})`;
  } catch {
    return null;   // canvas bloqueado (CORS): círculo blanco
  }
}

/** Marco del logo: círculo (o rectángulo redondeado si el logo es muy ancho) del color de su fondo, sin recortar nada. */
function marcoLogo(url, nombre) {
  const marco = h("div", { class: "lk-logo" });
  const sinLogo = () => marco.replaceChildren(h("span", { class: "lk-iniciales", "aria-hidden": "true" }, iniciales(nombre)));
  if (!url) { sinLogo(); return marco; }
  const cargar = (conCors) => {
    const img = new Image();
    img.alt = `Logo de ${nombre}`;
    img.decoding = "async";
    if (conCors) img.crossOrigin = "anonymous";
    img.addEventListener("load", () => {
      const prop = img.naturalWidth / img.naturalHeight;
      if (prop > 1.6) {
        marco.classList.add("ancho");
        marco.style.aspectRatio = String(Math.min(prop, 3));
      }
      const fondo = conCors ? colorDeFondo(img) : null;
      if (fondo) { marco.style.background = fondo; marco.classList.add("con-fondo"); }
      marco.replaceChildren(img);
    });
    img.addEventListener("error", () => (conCors ? cargar(false) : sinLogo()));   // sin CORS: se muestra igual, en blanco
    img.src = url;
  };
  cargar(true);
  return marco;
}

const iniciales = (nombre) => {
  const w = (nombre || "").trim().split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] || "T") + (w[1]?.[0] || "")).toUpperCase();
};

// ---------- Página ----------
/**
 * t = datos de taller_publico (nombre, logo_path, color_marca, direccion, whatsapp, maps_url, tiktok_url, reservas, horario, turno_minutos)
 * api = { logoUrl, hoy: "AAAA-MM-DD", maxFecha, cargarHoras(fecha) → Promise<{ data, error }>, reservar(datos) → Promise<{ data, error }> }
 */
export function pintarPagina(raiz, t, api) {
  const pal = paleta(t.color_marca);
  for (const [k, v] of Object.entries(pal)) document.documentElement.style.setProperty(k, v);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", pal["--marca-oscura"]);
  document.title = t.nombre;
  const wa = telWa(t.whatsapp);
  const estado = estadoHorario(t.horario);

  const tarjeta = ({ href, ico, titulo, sub, cls, externo, onclick }) =>
    h("a", { class: `lk-tarjeta ${cls || ""}`, href, target: externo ? "_blank" : null, rel: externo ? "noopener" : null, onclick },
      h("span", { class: `lk-tarjeta-ico ico-${ico}` }, icono(ico)),
      h("span", { class: "lk-tarjeta-txt" }, h("b", {}, titulo), h("span", {}, sub)),
      icono("flecha", "lk-tarjeta-flecha"));

  const tarjetas = [];
  if (t.reservas) tarjetas.push(tarjeta({ href: "#reservar", ico: "reservar", titulo: "Reservar turno", sub: "Elige día y hora", cls: "destacada",
    onclick: (e) => { e.preventDefault(); document.getElementById("reservar")?.scrollIntoView({ behavior: "smooth" }); } }));
  if (wa) tarjetas.push(tarjeta({ href: `https://wa.me/${wa}?text=${encodeURIComponent(`Hola ${t.nombre}, quisiera información.`)}`,
    ico: "whatsapp", titulo: "WhatsApp", sub: formatoTel(wa), externo: true }));
  if (t.maps_url) tarjetas.push(tarjeta({ href: t.maps_url, ico: "ubicacion", titulo: "Ubicación", sub: "Cómo llegar", externo: true }));
  if (t.tiktok_url) tarjetas.push(tarjeta({ href: t.tiktok_url, ico: "tiktok", titulo: "TikTok", sub: "Mira nuestros trabajos", externo: true }));

  raiz.replaceChildren(
    h("header", { class: "lk-hero" }, h("div", { class: "lk-hero-fondo" },
      h("div", { class: "lk-hero-herramientas", "aria-hidden": "true" }), h("div", { class: "lk-hero-carbono", "aria-hidden": "true" }))),
    h("div", { class: "lk-cuerpo" },
      h("div", { class: "lk-perfil" },
        marcoLogo(api.logoUrl, t.nombre),
        h("h1", {}, t.nombre),
        t.direccion ? h("p", { class: "lk-dir" }, icono("pin"), h("span", {}, t.direccion)) : "",
        estado ? h("p", { class: `lk-estado ${estado.abierto ? "abierto" : "cerrado"}` }, h("i", { "aria-hidden": "true" }), estado.texto) : ""),
      h("nav", { class: "lk-tarjetas", "aria-label": "Enlaces del taller" }, tarjetas),
      t.reservas ? seccionReserva(t, api, wa) : "",
      h("footer", { class: "lk-pie" }, icono("auto", "lk-pie-auto"), h("br"), "Hecho con ",
        h("a", { href: "https://karenariasbme.github.io/KarenArias/", target: "_blank", rel: "noopener" }, "Zynthea Solutions"))));
}

function seccionReserva(t, api, wa) {
  const fmtDia = new Intl.DateTimeFormat("es-EC", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
  const fmtHora = new Intl.DateTimeFormat("es-EC", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
  const hoyDia = ahoraEc().dia;

  const chipsHorario = h("ul", { class: "lk-chips-horario", "aria-label": "Horario de atención" },
    [1, 2, 3, 4, 5, 6, 7].map((d) => {
      const r = t.horario?.[d];
      return h("li", { class: `${d === hoyDia ? "hoy" : ""} ${r ? "" : "cerrado"}`.trim() || null },
        h("b", {}, DIAS_CORTOS[d]), ...(r ? [h("span", {}, r[0]), h("span", { "aria-label": `a ${r[1]}` }, r[1])] : [h("span", {}, "Cerrado")]));
    }));

  const fecha = h("input", { class: "lk-input", type: "date", name: "fecha", min: api.hoy, max: api.maxFecha, required: true, id: "lk-fecha" });
  const horas = h("div", { class: "lk-horas", role: "radiogroup", "aria-labelledby": "lk-horas-lbl" });
  const msg = h("p", { class: "lk-msg", role: "alert", hidden: true });
  let elegida = null;

  async function cargarHoras() {
    elegida = null;
    msg.hidden = true;
    if (!fecha.value) return horas.replaceChildren(h("p", { class: "lk-nota" }, "Primero elige una fecha."));
    horas.replaceChildren(h("p", { class: "lk-nota" }, "Buscando horarios…"));
    const { data, error } = await api.cargarHoras(fecha.value);
    if (error) return horas.replaceChildren(h("p", { class: "lk-nota" }, "No se pudieron cargar los horarios. Inténtalo de nuevo."));
    if (!data?.length) return horas.replaceChildren(h("p", { class: "lk-nota" }, "No hay horarios libres ese día. Prueba con otra fecha."));
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
  horas.replaceChildren(h("p", { class: "lk-nota" }, "Primero elige una fecha."));

  const campo = (label, control, id) => h("div", { class: "lk-campo" }, h("label", { for: id }, label), control);
  const btnReservar = h("button", { class: "lk-boton", type: "submit" }, icono("reservar"), h("span", {}, "Reservar turno"));
  const form = h("form", { class: "lk-form", novalidate: true },
    campo("Fecha", fecha, "lk-fecha"),
    h("div", { class: "lk-campo" }, h("span", { class: "lk-etq", id: "lk-horas-lbl" }, "Hora"), horas),
    campo("Tu nombre", h("input", { class: "lk-input", id: "lk-nombre", name: "nombre", required: true, maxlength: 120, autocomplete: "name", placeholder: "Nombre y apellido" }), "lk-nombre"),
    campo("Teléfono / WhatsApp", h("input", { class: "lk-input", id: "lk-tel", name: "telefono", type: "tel", required: true, maxlength: 20, autocomplete: "tel", placeholder: "0991234567" }), "lk-tel"),
    h("div", { class: "lk-fila" },
      campo("Placa (opcional)", h("input", { class: "lk-input", id: "lk-placa", name: "placa", maxlength: 10, autocapitalize: "characters", placeholder: "ABC-1234" }), "lk-placa")),
    campo("¿Qué necesitas? (opcional)", h("textarea", { class: "lk-input", id: "lk-motivo", name: "motivo", rows: 3, maxlength: 300, placeholder: "Ej.: cambio de aceite, revisión de frenos" }), "lk-motivo"),
    msg,
    btnReservar);

  const caja = h("section", { class: "lk-card lk-reserva", id: "reservar", "aria-labelledby": "lk-reserva-titulo" },
    h("div", { class: "lk-card-head" },
      h("span", { class: "lk-card-ico" }, icono("taller")),
      h("div", {}, h("h2", { id: "lk-reserva-titulo" }, "Reservar turno"),
        h("p", {}, `Turnos de ${t.turno_minutos >= 60 ? `${t.turno_minutos / 60} h` : `${t.turno_minutos} min`} · te confirmamos por WhatsApp`))),
    h("div", { class: "lk-horario-blk" }, h("span", { class: "lk-etq" }, icono("reloj"), "Horario"), chipsHorario),
    form);

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    msg.hidden = true;
    const fd = new FormData(form);
    const nombre = (fd.get("nombre") || "").trim();
    const tel = (fd.get("telefono") || "").replace(/\D/g, "");
    const error = (txt) => { msg.textContent = txt; msg.hidden = false; };
    if (!fecha.value) return error("Elige una fecha.");
    if (!elegida) return error("Elige una hora.");
    if (nombre.length < 2) return error("Escribe tu nombre.");
    if (!/^\d{9,15}$/.test(tel)) return error("Escribe un teléfono válido, por ejemplo 0991234567.");
    btnReservar.disabled = true;
    btnReservar.lastChild.textContent = "Reservando…";
    const { data, error: e } = await api.reservar({
      p_fecha_hora: elegida, p_nombre: nombre, p_telefono: tel,
      p_placa: (fd.get("placa") || "").trim() || null, p_motivo: (fd.get("motivo") || "").trim() || null,
    });
    btnReservar.disabled = false;
    btnReservar.lastChild.textContent = "Reservar turno";
    if (e) {
      error(["22023", "P0002"].includes(e.code) ? e.message : "No se pudo reservar. Revisa tu conexión e inténtalo de nuevo.");
      if (/lleno|horario/i.test(e.message || "")) cargarHoras();
      return;
    }
    const cuando = `${fmtDia.format(new Date(data.fecha_hora))} a las ${fmtHora.format(new Date(data.fecha_hora))}`;
    caja.replaceChildren(h("div", { class: "lk-exito", role: "status" },
      icono("check", "lk-exito-ico"),
      h("h2", {}, "¡Turno reservado!"),
      h("p", {}, `${data.taller} recibió tu reserva para el `, h("b", {}, cuando), ". Te confirmarán por WhatsApp."),
      wa ? h("a", { class: "lk-boton", target: "_blank", rel: "noopener",
        href: `https://wa.me/${wa}?text=${encodeURIComponent(`Hola, acabo de reservar un turno para el ${cuando} a nombre de ${nombre}.`)}` },
        icono("whatsapp"), h("span", {}, "Avisar por WhatsApp")) : ""));
    caja.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  return caja;
}

/** Página de "no disponible" o de error. */
export function pintarAviso(raiz, titulo, texto, accion) {
  for (const [k, v] of Object.entries(paleta(null))) document.documentElement.style.setProperty(k, v);
  raiz.replaceChildren(
    h("header", { class: "lk-hero corto" }, h("div", { class: "lk-hero-fondo" },
      h("div", { class: "lk-hero-herramientas", "aria-hidden": "true" }), h("div", { class: "lk-hero-carbono", "aria-hidden": "true" }))),
    h("div", { class: "lk-cuerpo" }, h("section", { class: "lk-card lk-aviso" }, h("h1", {}, titulo), h("p", {}, texto), accion || "")));
}
