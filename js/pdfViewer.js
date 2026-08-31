let pdfDoc = null;
let renderTask = null;
let pdfJsReady = null;

function ensurePdfJs() {
  if (globalThis.pdfjsLib) {
    return Promise.resolve(globalThis.pdfjsLib);
  }

  if (pdfJsReady) {
    return pdfJsReady;
  }

  pdfJsReady = new Promise((resolve, reject) => {
    const script = document.querySelector('script[data-pdfjs="true"]');
    if (!script) {
      reject(new Error("Le script PDF.js est introuvable dans index.html."));
      return;
    }

    const complete = () => {
      if (globalThis.pdfjsLib) {
        resolve(globalThis.pdfjsLib);
      } else {
        reject(new Error("PDF.js a été chargé mais n'expose pas pdfjsLib."));
      }
    };

    if (script.dataset.loaded === "true") {
      complete();
      return;
    }

    script.addEventListener(
      "load",
      () => {
        script.dataset.loaded = "true";
        complete();
      },
      { once: true },
    );
    script.addEventListener(
      "error",
      () => reject(new Error("Le chargement de PDF.js a échoué. Vérifiez l'accès réseau au CDN.")),
      { once: true },
    );
  });

  return pdfJsReady;
}

export async function loadPdfDocument(dataUrl) {
  if (!dataUrl) {
    pdfDoc = null;
    return null;
  }

  const pdfjsLib = await ensurePdfJs();
  const source = typeof dataUrl === "object" && dataUrl !== null ? dataUrl : { data: dataUrl };
  const loadingTask = pdfjsLib.getDocument({
    ...source,
    disableWorker: true,
    isEvalSupported: false,
    useWorkerFetch: false,
  });
  let timeoutHandle = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = window.setTimeout(() => {
      reject(
        new Error(
          "L'analyse du PDF prend trop de temps. Essayez un PDF plus leger ou rechargez la page.",
        ),
      );
    }, 15000);
  });

  try {
    pdfDoc = await Promise.race([loadingTask.promise, timeoutPromise]);
    return pdfDoc;
  } finally {
    window.clearTimeout(timeoutHandle);
  }
}

export function getPdfDocument() {
  return pdfDoc;
}

export async function renderPage(pageNumber, canvas, containerWidth, containerHeight) {
  if (!pdfDoc) {
    return;
  }

  if (renderTask) {
    try {
      renderTask.cancel();
    } catch (error) {
      console.debug("Rendu précédent annulé.", error);
    }
  }

  const page = await pdfDoc.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const targetWidth = Math.max(1, containerWidth);
  const targetHeight = Math.max(1, containerHeight);
  const scale = Math.min(targetWidth / baseViewport.width, targetHeight / baseViewport.height);
  const viewport = page.getViewport({ scale });
  const context = canvas.getContext("2d");

  canvas.width = viewport.width;
  canvas.height = viewport.height;

  renderTask = page.render({
    canvasContext: context,
    viewport,
  });

  try {
    await renderTask.promise;
  } catch (error) {
    if (error?.name !== "RenderingCancelledException") {
      throw error;
    }
  } finally {
    renderTask = null;
  }
}
