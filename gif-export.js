"use strict";
async function exportGif(gif, format, frame, progress) {
  const {width,height} = gif;
  if (format === "jpg") {
    let i = 0;
    for (const screen of GifTools.screens(gif)) {
      if (++i !== frame) continue;
      const ctx = GifTools.canvas(width,height);
      ctx.fillStyle = "white";
      ctx.fillRect(0,0,width,height);
      ctx.drawImage(screen,0,0);
      const blob = await new Promise(resolve => ctx.canvas.toBlob(resolve,"image/jpeg",.94));
      if (!blob) throw Error("JPG를 생성할 수 없습니다.");
      return {blob,width,height};
    }
    throw Error("저장할 프레임 번호를 확인해 주세요.");
  }
  // H.264 uses even dimensions; pad the right/bottom edge for odd sizes.
  const w = width + width%2, h = height + height%2;
  const ctx = GifTools.canvas(w,h);
  const times = GifTools.ticks(gif);
  function gcd(a,b) { return b ? gcd(b,a%b) : a; }
  const step = times.reduce(gcd,100);
  const encoder = await HME.createH264MP4Encoder();
  try {
    encoder.width = w;
    encoder.height = h;
    encoder.frameRate = 100 / step;
    encoder.initialize();
    let i = 0;
    for (const screen of GifTools.screens(gif)) {
      ctx.fillStyle = "white";
      ctx.fillRect(0,0,w,h);
      ctx.drawImage(screen,0,0);
      const pixels = ctx.getImageData(0,0,w,h).data;
      const count = times[i] / step;
      progress(++i,times.length);
      await GifTools.pause();
      for (let j = 0; j < count; j++) {
        encoder.addFrameRgba(pixels);
        if (j%16 === 15) await GifTools.pause();
      }
    }
    encoder.finalize();
    const bytes = encoder.FS.readFile(encoder.outputFilename);
    return {blob:new Blob([bytes],{type:"video/mp4"}),width:w,height:h};
  } finally {
    encoder.delete();
  }
}
