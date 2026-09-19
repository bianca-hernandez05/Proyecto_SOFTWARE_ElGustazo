const QRCode = require('qrcode');

function QRCodeWrapper(target, options) {
    if (typeof options === 'string') options = { text: options };
    const opts = Object.assign({
        width: 160,
        margin: 2,
        errorCorrectionLevel: 'M',
        color: { dark: '#000000', light: '#ffffff' }
    }, options);

    const el = typeof target === 'string' ? document.getElementById(target) : target;
    if (!el) return;

    if (opts.text) {
        // Generar SVG nítido y de alto contraste con zona de silencio (margen)
        QRCode.toString(opts.text, {
            type: 'svg',
            width: opts.width,
            margin: opts.margin,
            errorCorrectionLevel: opts.errorCorrectionLevel,
            color: opts.color
        }, (err, svgString) => {
            if (!err && svgString) {
                el.innerHTML = svgString;
                const svg = el.querySelector('svg');
                if (svg) {
                    svg.style.width = opts.width + 'px';
                    svg.style.height = opts.width + 'px';
                    svg.style.display = 'block';
                    svg.style.margin = '0 auto';
                    svg.style.borderRadius = '8px';
                    svg.style.boxShadow = '0 2px 10px rgba(0,0,0,0.12)';
                    svg.style.background = '#ffffff';
                    svg.style.padding = '6px';
                }
            } else if (typeof document !== 'undefined') {
                const canvas = document.createElement('canvas');
                QRCode.toCanvas(canvas, opts.text, opts, (canvasErr) => {
                    if (!canvasErr) {
                        el.innerHTML = '';
                        el.appendChild(canvas);
                    }
                });
            }
        });
    }
}

QRCodeWrapper.toDataURL = QRCode.toDataURL;
QRCodeWrapper.toCanvas = QRCode.toCanvas;
QRCodeWrapper.toString = QRCode.toString;

if (typeof window !== 'undefined') {
    window.QRCode = QRCodeWrapper;
}
module.exports = QRCodeWrapper;
