// Keep the original color tables and control blocks. Each frame uses the
// same logical-screen sampling grid, including frames covering a subrectangle.
function inspectGif(bytes) {
  const signature = String.fromCharCode(...bytes.subarray(0, 6));
  if (!["GIF87a", "GIF89a"].includes(signature)) throw Error("편집 가능한 파일은 GIF 형식뿐입니다.");
  const invalid = () => { throw Error("GIF 파일을 읽을 수 없습니다. 파일이 손상되었는지 확인해 주세요."); };
  const word = pos => bytes[pos] | bytes[pos + 1] << 8;
  const paletteBytes = flags => flags & 128 ? 3 * (2 << (flags & 7)) : 0;
  const width = word(6), height = word(8);
  let pos = 13 + paletteBytes(bytes[10]);
  const frames = [];
  let control = null;
  function skipBlocks() {
    while (pos < bytes.length) {
      const length = bytes[pos++];
      if (!length) return;
      pos += length;
    }
    invalid();
  }
  while (pos < bytes.length) {
    const start = pos;
    const type = bytes[pos++];
    if (type === 0x3b && width && height && frames.length) return { bytes, width, height, frames };
    if (type === 0x21) {
      const label = bytes[pos++];
      if (label === 0xf9) {
        if (bytes[pos] !== 4 || bytes[pos + 5] !== 0) invalid();
        control = start;
      }
      if (label === 1) control = null;
      skipBlocks();
      continue;
    }
    if (type !== 0x2c) invalid();
    const x = word(pos), y = word(pos + 2), w = word(pos + 4), h = word(pos + 6);
    const flags = bytes[pos + 8];
    if (!w || !h || x + w > width || y + h > height) invalid();
    pos += 9 + paletteBytes(flags);
    const data = pos++;
    if (!(bytes[data] >= 2 && bytes[data] <= 8)) invalid();
    skipBlocks();
    frames.push({ start, x, y, w, h, flags, data, end: pos, control });
    control = null;
  }
  invalid();
}

async function resizeGif(gif, width, height, progress) {
  const { bytes, frames } = gif;
  if (Math.max(width, height) > 65535) throw Error("GIF의 가로와 세로는 각각 65,535px까지 가능합니다.");
  const options = { type: "image/gif" };
  if (width === gif.width && height === gif.height) return new Blob([bytes], options);
  const dimensions = (...values) => Uint8Array.from(values.flatMap(v => [v & 255, v >> 8]));
  const parts = [bytes.subarray(0, 6), dimensions(width, height)];
  let cursor = 10;
  const boundary = (v, source, target) => Math.ceil(v * target / source - 0.5);
  const sample = (v, source, target) => Math.floor((v + 0.5) * source / target);
  for (const [i, f] of frames.entries()) {
    progress(i + 1, frames.length);
    await new Promise(resolve => setTimeout(resolve, 0));
    let x = boundary(f.x, gif.width, width), y = boundary(f.y, gif.height, height);
    let w = boundary(f.x + f.w, gif.width, width) - x;
    let h = boundary(f.y + f.h, gif.height, height) - y;
    let pixels;
    if (w && h) {
      if (Math.max(w * h, f.w * f.h) > 64 * 1024 * 1024) throw Error("이 프레임을 처리할 메모리가 부족합니다. 더 작은 크기를 선택해 주세요.");
      const indices = new Uint8Array(f.w * f.h);
      GifReaderLZWOutputIndexStream(bytes, f.data, indices, indices.length);
      const rows = new Uint32Array(f.h);
      if (f.flags & 64) {
        let row = 0;
        for (const [start, step] of [[0,8],[4,8],[2,4],[1,2]]) {
          for (let j = start; j < f.h; j += step) rows[j] = row++;
        }
      }
      const columns = Uint32Array.from({ length: w }, (_, j) => sample(x + j, gif.width, width) - f.x);
      pixels = new Uint8Array(w * h);
      for (let j = 0; j < h; j++) {
        const row = sample(y + j, gif.height, height) - f.y;
        const offset = (f.flags & 64 ? rows[row] : row) * f.w;
        for (let k = 0; k < w; k++) pixels[j * w + k] = indices[offset + columns[k]];
      }
    } else {
      // No destination pixel samples this frame. Keep its duration with a
      // transparent, non-disposing pixel so subsequent frames stay aligned.
      if (f.control !== null) {
        parts.push(bytes.subarray(cursor, f.control));
        cursor = f.control + 8;
      }
      parts.push(bytes.subarray(cursor, f.start), Uint8Array.of(33,249,4,5,
        f.control === null ? 0 : bytes[f.control + 4], f.control === null ? 0 : bytes[f.control + 5],0,0));
      cursor = f.start;
      x = y = 0;
      w = h = 1;
      pixels = Uint8Array.of(0);
    }
    const compressed = new Uint8Array(2 * pixels.length + 32);
    const end = GifWriterOutputLZWCodeStream(compressed, 0, bytes[f.data], pixels);
    parts.push(bytes.subarray(cursor, f.start + 1), dimensions(x, y, w, h),
      Uint8Array.of(f.flags & ~64), bytes.subarray(f.start + 10, f.data), compressed.slice(0, end));
    cursor = f.end;
  }
  parts.push(bytes.subarray(cursor));
  return new Blob(parts, options);
}
