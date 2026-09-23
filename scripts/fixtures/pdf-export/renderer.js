// Only the rasterizer is simulated. The real exporter still isolates the DOM,
// enforces its deadline, paginates, builds the PDF and starts the download.
export default function capture(element, options) {
  window.qaCaptures.push({
    isolated: element.ownerDocument !== document,
    text: element.textContent,
    fonts: [...element.querySelectorAll('*')].map(n => n.style.fontFamily),
    controls: element.querySelectorAll('button, .no-print').length,
    extraResources: element.ownerDocument.querySelectorAll('link, style, #unrelated-image').length,
    options,
  });
  // html2canvas 1.4.1 waits for the cloned document's fonts before rendering.
  // Reproduce the old full-page capture hanging on an unrelated webfont.
  if (element.ownerDocument === document) return document.fonts.ready.then(() => window.qaCapture(element, options));
  return window.qaCapture(element, options);
}
