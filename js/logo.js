// Logo del taller: detección del color de fondo y carga con CORS.
// La usan la página de enlaces (enlaces-vista.js) y la app (tallerLogo en ui.js: barra superior, Mi taller,
// orden, presupuesto y PDF), para que el logo encaje igual en todos lados.
//  · Esquinas iguales → el marco toma ese color.
//  · Esquinas distintas pero todas oscuras (fondo con textura) o todas muy claras → tono del medio de las esquinas.
//  · Transparente, esquinas de colores distintos o canvas bloqueado (CORS) → marco blanco.
//  · Logo muy ancho (proporción > 1,6) → marco rectangular redondeado en vez de círculo.
//  · Siempre object-fit: contain con margen interno: nunca se recorta texto del logo.

/** Color de fondo del logo leyendo sus 4 esquinas con canvas; null si es transparente, si varían o si falla (CORS). */
export function colorDeFondo(img) {
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

/**
 * Carga el logo con CORS (para poder leer su fondo); si el servidor no lo permite, lo carga sin CORS (marco blanco).
 * listo({ img, fondo, ancho, proporcion }) · error() si no carga de ninguna forma.
 */
export function cargarLogo(url, alt, { listo, error }) {
  const cargar = (conCors) => {
    const img = new Image();
    img.alt = alt;
    img.decoding = "async";
    if (conCors) img.crossOrigin = "anonymous";
    img.addEventListener("load", () => {
      const proporcion = img.naturalWidth / img.naturalHeight;
      listo({ img, fondo: conCors ? colorDeFondo(img) : null, ancho: proporcion > 1.6, proporcion });
    });
    img.addEventListener("error", () => (conCors ? cargar(false) : error?.()));
    img.src = url;
  };
  cargar(true);
}
