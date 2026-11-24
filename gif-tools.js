"use strict";
const GifTools = (() => {
  const gifBlob = parts => new Blob(parts, { type: "image/gif" });
  const pause = () => new Promise(resolve => setTimeout(resolve, 0));
  const clampDimension = n => Math.max(1, Math.round(n));
  function canvas(w, h) {
    const surface = document.createElement("canvas");
    surface.width = w;
    surface.height = h;
    return surface.getContext("2d", { willReadFrequently: true });
  }
  function delays(gif) {
    return gif.frames.map(({control}) => control === null ? 0 :
      gif.bytes[control + 4] + 256 * gif.bytes[control + 5]);
  }
  function ticks(gif) {
    return delays(gif).map(delay => delay || 10);
  }
  async function compress(gif, flags) {
    const files = await gifsicle.run({ input: [{name: "input.gif", file: gif}],
      command: [flags + " input.gif -o /out/result.gif"] });
    if (!files?.[0]?.size) throw Error("GIF를 처리할 수 없습니다. 다른 설정으로 다시 시도해 주세요.");
    return files[0];
  }
  // Decode on the logical screen before reordering or dropping any frames.
  function* screens(gif) {
    const {bytes, width, height} = gif;
    const ctx = canvas(width, height);
    for (const f of gif.frames) {
      const flags = f.control === null ? 0 : bytes[f.control + 3];
      const transparent = flags & 1 ? bytes[f.control + 6] : -1;
      const disposal = (flags >> 2) & 7;
      const region = ctx.getImageData(f.x, f.y, f.w, f.h);
      const old = disposal === 3 ? new ImageData(region.data.slice(), f.w, f.h) : null;
      const pixels = new Uint8Array(f.w * f.h);
      GifReaderLZWOutputIndexStream(bytes, f.data, pixels, pixels.length);
      const palette = (f.flags & 128) ? f.start + 10 : 13;
      const passes = f.flags & 64 ? [[0,8],[4,8],[2,4],[1,2]] : [[0,1]];
      let p = 0;
      for (const [first, step] of passes) {
        for (let y = first; y < f.h; y += step) {
          for (let x = 0; x < f.w; x++) {
            const index = pixels[p++];
            if (index === transparent) continue;
            const dst = (y * f.w + x) * 4, src = palette + 3 * index;
            region.data[dst] = bytes[src];
            region.data[dst+1] = bytes[src+1];
            region.data[dst+2] = bytes[src+2];
            region.data[dst+3] = 255;
          }
        }
      }
      ctx.putImageData(region, f.x, f.y);
      yield ctx.canvas;
      if (old) ctx.putImageData(old, f.x, f.y);
      if (disposal === 2) ctx.clearRect(f.x, f.y, f.w, f.h);
    }
  }
  function indexed(rgba) {
    const table = new Map(), indices = new Uint8Array(rgba.length / 4);
    for (let i = 0; i < indices.length; i++) {
      const p = 4 * i;
      const key = rgba[p+3] < 128 ? -1 : (rgba[p]<<16) | (rgba[p+1]<<8) | rgba[p+2];
      if (!table.has(key)) table.set(key, table.size);
      if (table.size > 256) {
        const palette = quantize(rgba, 255);
        const pixels = applyPalette(rgba, palette);
        const transparent = palette.length;
        palette.push([0,0,0]);
        for (let j = 0; j < pixels.length; j++) if (rgba[4*j+3] < 128) pixels[j] = transparent;
        return {indices: pixels, palette: palette.map(([r,g,b]) => r<<16 | g<<8 | b), transparent};
      }
      indices[i] = table.get(key);
    }
    return {indices, palette: Array.from(table.keys(), n => Math.max(0,n)), transparent: table.get(-1)};
  }
  function encodeFrame(writer, ctx, delay) {
    const {indices,palette,transparent} = indexed(ctx.getImageData(0,0,ctx.canvas.width,ctx.canvas.height).data);
    while (palette.length < 2 || palette.length & (palette.length-1)) palette.push(0);
    const buf = new Uint8Array(indices.length * 2 + 1024);
    writer.setOutputBuffer(buf);
    writer.setOutputBufferPosition(0);
    writer.addFrame(0,0,ctx.canvas.width,ctx.canvas.height,indices,{palette,delay,transparent,disposal:2});
    return buf.slice(0,writer.getOutputBufferPosition());
  }
  function cropSize(gif, ratio) {
    return [clampDimension(Math.min(gif.width, gif.height*ratio)),clampDimension(Math.min(gif.height,gif.width/ratio))];
  }
  function scaledTimes(gif, rate) {
    let desiredEnd = 0, actualEnd = 0;
    return ticks(gif).map(time => {
      desiredEnd += time/rate;
      const delay = Math.max(1,Math.round(desiredEnd)-actualEnd);
      actualEnd += delay;
      return delay;
    });
  }
  function speed(gif, times) {
    const parts = [];
    let pos = 0;
    for (const [i,f] of gif.frames.entries()) {
      const delay = times[i];
      if (f.control === null) {
        parts.push(gif.bytes.subarray(pos,f.start),Uint8Array.of(33,249,4,0,delay&255,delay>>8,0,0));
        pos = f.start;
      } else {
        parts.push(gif.bytes.subarray(pos,f.control+4),Uint8Array.of(delay&255,delay>>8));
        pos = f.control+6;
      }
    }
    parts.push(gif.bytes.subarray(pos));
    return gifBlob(parts);
  }
  async function edit(gif, tool, opts, progress) {
    const input = gifBlob([gif.bytes]);
    if (tool === "Rotate") return compress(input,opts.rotate);
    let scaled;
    if (tool === "Speed") {
      if (opts.rate === 1) return input;
      scaled = scaledTimes(gif,opts.rate);
      if (scaled.every(time => time <= 65535)) return speed(gif,scaled);
    }
    if (tool === "Optimize") {
      const file = await compress(input,"-O3 --careful --no-comments --no-names");
      return file.size < input.size ? file : input;
    }
    let {width,height} = gif;
    if (tool === "Crop") {
      [width,height] = cropSize(gif,opts.ratio);
      if (opts.fill === "cover") {
        const x = Math.floor((gif.width-width)/2), y = Math.floor((gif.height-height)/2);
        return compress(input,"--crop " + x + "," + y + "+" + width + "x" + height);
      }
    }
    const down = tool === "Downsizing";
    if (down && !opts.shrink && !opts.drop && !opts.low) throw Error("용량을 줄일 방법을 한 가지 이상 선택해 주세요.");
    if (down && opts.shrink) {
      width = clampDimension(width * .75);
      height = clampDimension(height * .75);
    }
    const target = canvas(width,height);
    const low = down && opts.low ? canvas(clampDimension(width/2),clampDimension(height/2)) : null;
    const header = [];
    const loop = new GifReader(gif.bytes).loopCount();
    const writer = new GifWriter(header,width,height,{loop, palette:[0,0]});
    const chunks = [], times = ticks(gif), raw = delays(gif);
    let index = 0, time = 0;
    for (const screen of screens(gif)) {
      const i = index++, start = time;
      time += times[i];
      if (tool === "Cut" && (time <= opts.start || start >= opts.end)) continue;
      const last = times.length - 1;
      if (down && opts.drop && i % 2 && i !== last) continue;
      let delay = scaled ? scaled[i] : raw[i];
      if (tool === "Cut") delay = Math.min(time,opts.end) - Math.max(start,opts.start);
      if (down && opts.drop && i+1 < last) delay = times[i] + times[i+1];
      target.clearRect(0,0,width,height);
      if (tool === "Crop") {
        target.fillStyle = opts.color;
        target.fillRect(0,0,width,height);
        const scale = Math.min(width/screen.width,height/screen.height);
        const w = clampDimension(screen.width*scale), h = clampDimension(screen.height*scale);
        target.drawImage(screen,Math.floor((width-w)/2),Math.floor((height-h)/2),w,h);
      } else if (low) {
        low.clearRect(0,0,low.canvas.width,low.canvas.height);
        low.drawImage(screen,0,0,low.canvas.width,low.canvas.height);
        target.imageSmoothingEnabled = false;
        target.drawImage(low.canvas,0,0,width,height);
      } else {
        target.drawImage(screen,0,0,width,height);
      }
      do {
        chunks.push(encodeFrame(writer,target,Math.min(65535,delay)));
        delay -= 65535;
      } while (delay > 0);
      progress(i+1,times.length);
      await pause();
    }
    if (!chunks.length) throw Error("남길 구간을 확인해 주세요.");
    if (tool === "Reverse") chunks.reverse();
    const blob = gifBlob([Uint8Array.from(header),...chunks,Uint8Array.of(59)]);
    if (down) {
      const smaller = await compress(blob,"-O3");
      return smaller.size < blob.size ? smaller : blob;
    }
    return blob;
  }
  return {edit,ticks,screens,canvas,pause};
})();
