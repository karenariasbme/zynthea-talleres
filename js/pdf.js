// PDF de la orden o del presupuesto, generado en el navegador a partir del mismo documento que se imprime.
// La librería (html2pdf.js: html2canvas + jsPDF, ~900 KB) se descarga solo la primera vez que se pulsa un botón de PDF.
// El documento nunca incluye costos, así que el PDF tampoco.
const URL_LIB = "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js";
let carga = null;

function libreria() {
  if (window.html2pdf) return Promise.resolve(window.html2pdf);
  carga ??= new Promise((ok, mal) => {
    const s = document.createElement("script");
    s.src = URL_LIB;
    s.onload = () => (window.html2pdf ? ok(window.html2pdf) : mal(new Error("sin html2pdf")));
    s.onerror = () => { carga = null; mal(new Error("No se pudo cargar el generador de PDF. Revisa tu conexión.")); };
    document.head.append(s);
  });
  return carga;
}

/** Vuelve a cargar las imágenes con CORS para que el logo (Supabase Storage) salga en el PDF. */
function imagenesConCors(raiz) {
  return Promise.all([...raiz.querySelectorAll("img")].map((img) => new Promise((listo) => {
    const src = img.getAttribute("src");
    if (!src || src.startsWith("data:")) return listo();
    img.crossOrigin = "anonymous";
    img.onload = listo;
    img.onerror = () => { img.remove(); listo(); };   // sin logo antes que un PDF fallido
    img.src = src + (src.includes("?") ? "&" : "?") + "pdf=1";
  })));
}

/** docEl: el <article class="print-doc"> que se ve en pantalla. Devuelve un File PDF (A4). */
export async function generarPdf(docEl, nombreArchivo) {
  if (!docEl) throw new Error("No hay documento para convertir en PDF.");
  const html2pdf = await libreria();
  // Copia en una capa fija en 0,0 (detrás de la página e invisible): hoja A4 de 794 px con el aspecto de impresión.
  // Nunca fuera de la vista con left negativo: con la pantalla bajada, html2canvas desplazaba el dibujo
  // (página 1 en blanco y la orden cortada a mitad de la página 2).
  const capa = document.createElement("div");
  capa.className = "pdf-capa";
  const hoja = document.createElement("div");
  hoja.className = "pdf-hoja";
  const copia = docEl.cloneNode(true);
  copia.querySelectorAll(".no-print").forEach((n) => n.remove());
  hoja.append(copia);
  capa.append(hoja);
  document.body.append(capa);
  try {
    await imagenesConCors(copia);
    const blob = await html2pdf().set({
      margin: [10, 0, 12, 0],   // los 10 mm de los lados ya están dentro de la hoja (padding de 38 px)
      filename: nombreArchivo,
      image: { type: "jpeg", quality: 0.95 },
      // scroll en 0 y ventana de 794 px: el dibujo no depende de cuánto bajó la pantalla ni del ancho del celular
      html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff", logging: false,
                     scrollX: 0, scrollY: 0, windowWidth: 794 },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      // Sin cortar secciones, datos, filas, totales, datos de pago ni firmas. La tabla de mano de obra y repuestos
      // puede seguir en la página siguiente, pero siempre entre filas (si no, una tabla larga dejaba media hoja vacía).
      pagebreak: { mode: ["css", "legacy"],
                   avoid: ["section:not(.doc-items)", ".doc-items h3", ".doc-head", ".doc-cols", ".dato",
                           "thead", "tr", "tfoot", ".doc-foot", ".doc-pago"] },
    }).from(hoja).outputPdf("blob");
    return new File([blob], nombreArchivo, { type: "application/pdf" });
  } finally {
    capa.remove();
  }
}

/** Descarga un archivo en el equipo. */
export function descargar(file) {
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement("a"), { href: url, download: file.name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
