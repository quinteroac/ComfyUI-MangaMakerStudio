export const aspectRatios = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '1:2', '2:1', '9:21', '21:9', '210:297', '297:210'];

export function sizeSettings(value) {
    if (value.aspect_ratio && value.megapixels != null) return { aspect_ratio: value.aspect_ratio, megapixels: Number(value.megapixels) };
    const width = Number(value.width || 1000), height = Number(value.height || 1000);
    const gcd = (a, b) => b ? gcd(b, a % b) : a;
    const divisor = gcd(width, height);
    return { aspect_ratio: `${width / divisor}:${height / divisor}`, megapixels: width * height / 1e6 };
}

export function imageDimensions(value, alignment = 8) {
    const { aspect_ratio, megapixels } = sizeSettings(value);
    const [x, y] = aspect_ratio.split(':').map(Number);
    if (![x, y, megapixels].every(n => Number.isFinite(n) && n > 0)) throw new Error('Use a positive aspect ratio and resolution in MP.');
    const width = Math.sqrt(megapixels * 1e6 * x / y);
    const height = Math.sqrt(megapixels * 1e6 * y / x);
    return { width: Math.max(alignment, Math.round(width / alignment) * alignment), height: Math.max(alignment, Math.round(height / alignment) * alignment) };
}

export function sizeLabel(value) {
    const size = sizeSettings(value);
    return `${Number(size.megapixels.toFixed(3))} MP · ${size.aspect_ratio}`;
}
