(() => {
  "use strict";
  const el = id => document.getElementById(id);
  const toolIcons = [
    ["Resize", "⤢"], ["Crop", "✂"], ["Downsizing", "↘"],
    ["Format Convert", "⇄"], ["Rotate", "⟳"], ["Optimize", "⚙"],
    ["Reverse", "◀◀"], ["Speed", "◷"], ["Cut", "✄"]
  ];
  let source, current, filename, originalUrl, resultUrl, resultBlob, sourceHandle, activeTool;
  let encoderReady;
  let locked = true, busy = false, lastAxis = "x";
  let steps = [], position = -1, previewUrl;
  let pendingWrite = Promise.resolve(), draftUnavailable = false;

  function persist(step) {
    const meta = position < 0 ? null : {position,filename,sourceHandle};
    pendingWrite = pendingWrite.then(() => {
      if (!meta || (step && meta.position === 0)) draftUnavailable = false;
      if (!draftUnavailable) return editorDraft.write(meta,step);
    }).catch(() => {
      draftUnavailable = true;
      el("draftNote").textContent = "이 브라우저에서는 작업 기록을 현재 화면에서만 유지합니다.";
    });
    return pendingWrite;
  }
  function drawHistory() {
    const list = el("steps");
    list.replaceChildren();
    steps.forEach((step,index) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.textContent = (index ? index + ". " : "") + step.label;
      button.disabled = busy || index === position;
      if (index === position) button.setAttribute("aria-current","step");
      button.onclick = () => jump(index);
      item.append(button);
      list.append(item);
    });
    el("undo").disabled = busy || position <= 0;
  }
  function drawResult() {
    const step = steps[position];
    const original = position === 0;
    const video = el("resultVideo");
    video.pause();
    video.removeAttribute("src");
    video.load();
    el("resultImage").removeAttribute("src");
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultBlob = original ? null : step.blob;
    resultUrl = original ? null : URL.createObjectURL(resultBlob);
    el("original").open = original;
    el("result").hidden = original;
    if (original) return;
    const isVideo = resultBlob.type === "video/mp4";
    el("resultImage").hidden = isVideo;
    video.hidden = !isVideo;
    (isVideo ? video : el("resultImage")).src = resultUrl;
    const resized = step.tool === "Resize";
    const name = resized ? "Resized_" + filename.replace(/\.gif$/i,"") + ".gif" : saveName();
    el("download").href = resultUrl;
    el("download").hidden = !resized;
    el("resultTitle").textContent = resized ? "Resized GIF" : extension().toUpperCase() + " 편집 결과";
    el("download").download = el("resultName").textContent = name;
    el("resultInfo").textContent = info(step.width,step.height,resultBlob,step.frames);
  }
  async function jump(index) {
    if (busy || !steps[index]) return;
    busy = true;
    el("workspace").inert = true;
    try {
      current = inspectGif(new Uint8Array(await steps[steps[index].gifStep].blob.arrayBuffer()));
      position = index;
      showTool("");
      drawResult();
      warning();
      el("status").textContent = steps[index].label + " 단계로 돌아왔습니다.";
      await persist();
    } catch {
      warning("작업 기록을 열지 못했습니다.");
    } finally {
      busy = false;
      el("workspace").inert = false;
      drawHistory();
    }
  }
  el("undo").onclick = () => jump(position-1);

  function warning(message = "") {
    el("warning").textContent = message;
    el("warning").hidden = !message;
  }
  function showTool(name) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    el("sizeImage").removeAttribute("src");
    activeTool = name;
    source = current;
    const resize = name === "Resize";
    el("toolTitle").textContent = name || "편집 도구";
    el("tools").hidden = Boolean(name);
    el("settings").hidden = !name;
    el("resizeControls").hidden = !resize;
    document.querySelectorAll("[data-tool]").forEach(panel => panel.hidden = panel.dataset.tool !== name);
    if (resize) {
      previewUrl = URL.createObjectURL(steps[steps[position].gifStep].blob);
      el("sizeImage").src = previewUrl;
      el("x").value = el("y").value = 100;
      updateSizes();
    }
    if (name === "Cut") {
      const seconds = GifTools.ticks(source).reduce((sum,n) => sum+n,0)/100;
      el("start").value = 0;
      el("end").value = el("start").max = el("end").max = seconds;
      el("duration").textContent = "전체 길이 " + seconds + "초";
    }
    if (name === "Format Convert") {
      el("jpgFrame").max = source.frames.length;
      el("jpgFrame").value = 1;
    }
    el("toolTitle").focus({ preventScroll: true });
  }
  for (const [name, icon] of toolIcons) {
    const button = document.createElement("button");
    const symbol = document.createElement("span");
    symbol.setAttribute("aria-hidden", "true");
    symbol.textContent = icon;
    button.append(symbol, name);
    button.onclick = () => showTool(name);
    el("tools").append(button);
  }
  el("back").onclick = () => showTool("");
  el("fill").onchange = () => el("colorField").hidden = el("fill").value !== "pad";
  el("format").onchange = () => el("jpgField").hidden = el("format").value !== "jpg";
  function size(axis) {
    return Math.max(1, Math.round(source[axis === "x" ? "width" : "height"] * el(axis).value / 100));
  }
  function updateSizes() {
    for (const axis of ["x", "y"]) {
      const label = el(axis).value + "% · " + size(axis) + " px";
      el(axis + "Value").value = label;
      el(axis).setAttribute("aria-valuetext", label);
    }
    el("lock").textContent = locked ? "🔒 비율 잠김" : "🔓 비율 풀림";
    el("lock").setAttribute("aria-pressed", String(locked));
    updatePreview();
  }
  function updatePreview() {
    if (!source || activeTool !== "Resize") return;
    const area = el("previewArea");
    const scale = Math.min((area.clientWidth-16)/(source.width*3),(area.clientHeight-16)/(source.height*3));
    el("sizeImage").style.width = Math.max(1,size("x")*scale) + "px";
    el("sizeImage").style.height = Math.max(1,size("y")*scale) + "px";
    el("previewSize").textContent = size("x") + " × " + size("y") + " px";
  }
  new ResizeObserver(updatePreview).observe(el("previewArea"));
  for (const axis of ["x", "y"]) el(axis).oninput = () => {
    lastAxis = axis;
    if (locked) el(axis === "x" ? "y" : "x").value = el(axis).value;
    updateSizes();
  };
  el("lock").onclick = () => {
    locked = !locked;
    if (locked) el(lastAxis === "x" ? "y" : "x").value = el(lastAxis).value;
    updateSizes();
  };
  function info(width, height, blob, frames) {
    const bytes = blob.size;
    const amount = bytes < 1024 ? bytes + " B" : bytes < 1048576
      ? (bytes / 1024).toFixed(1) + " KB" : (bytes / 1048576).toFixed(2) + " MB";
    return width + " × " + height + " px · " + amount + (frames ? " · " + frames + "프레임" : "");
  }
  async function load(files, handle = null, draft = null) {
    if (busy || !files.length) return;
    if (files.length !== 1) return warning("GIF 파일을 한 번에 1개만 선택해 주세요.");
    busy = true;
    warning();
    el("status").textContent = "파일을 확인하고 있습니다.";
    try {
      const file = files[0];
      const gif = inspectGif(new Uint8Array(await file.arrayBuffer()));
      const restored = draft && draft.position > 0
        ? inspectGif(new Uint8Array(await draft.steps[draft.steps[draft.position].gifStep].blob.arrayBuffer())) : gif;
      const url = URL.createObjectURL(new Blob([file], { type: "image/gif" }));
      if (originalUrl) URL.revokeObjectURL(originalUrl);
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      source = current = restored;
      sourceHandle = handle;
      resultBlob = null;
      filename = file.name;
      position = draft?.position ?? 0;
      steps = draft?.steps ?? [{tool:"",label:"원본 GIF",blob:new Blob([file],{type:"image/gif"}),gifStep:0}];
      el("draftNote").textContent = "";
      if (!draft) await persist(steps[0]);
      originalUrl = url;
      resultUrl = null;
      el("originalImage").src = url;
      el("originalName").textContent = filename;
      el("originalInfo").textContent = info(gif.width, gif.height, file, gif.frames.length);
      el("original").open = true;
      el("result").hidden = true;
      el("upload").hidden = true;
      el("workspace").hidden = false;
      el("x").value = el("y").value = 100;
      locked = true;
      updateSizes();
      showTool("");
      drawResult();
    } catch (error) {
      warning(error.message || "파일을 열 수 없습니다.");
    } finally {
      busy = false;
      drawHistory();
      el("status").textContent = "";
    }
  }
  el("reset").onclick = async () => {
    if (busy) return;
    busy = true;
    showTool("");
    for (const id of ["originalImage","resultImage","resultVideo"]) el(id).removeAttribute("src");
    el("resultVideo").load();
    el("download").removeAttribute("href");
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    originalUrl = resultUrl = resultBlob = current = source = sourceHandle = null;
    steps = [];
    position = -1;
    filename = "";
    drawHistory();
    await persist();
    warning();
    el("status").textContent = "";
    el("workspace").hidden = true;
    el("upload").hidden = false;
    busy = false;
    el("choose").focus();
  };
  el("choose").onclick = async () => {
    if (busy) return;
    if (!window.showOpenFilePicker) return el("file").click();
    try {
      const [handle] = await showOpenFilePicker({types:[{description:"GIF",accept:{"image/gif":[".gif"]}}]});
      await load([await handle.getFile()],handle);
    } catch (error) {
      if (error.name === "SecurityError") el("file").click();
      else if (error.name !== "AbortError") warning("파일을 열지 못했습니다. 다시 선택해 주세요.");
    }
  };
  el("file").onchange = event => {
    const files = Array.from(event.target.files);
    event.target.value = "";
    load(files);
  };
  for (const name of ["dragover", "drop"]) document.addEventListener(name, event => event.preventDefault());
  el("drop").ondragover = () => el("drop").classList.add("over");
  el("drop").ondragleave = () => el("drop").classList.remove("over");
  el("drop").ondrop = async event => {
    event.preventDefault();
    el("drop").classList.remove("over");
    const files = Array.from(event.dataTransfer.files);
    const item = event.dataTransfer.items[0];
    let handle;
    if (files.length === 1 && item?.getAsFileSystemHandle) {
      try { handle = await item.getAsFileSystemHandle(); } catch { /* The File is still accessible. */ }
    }
    load(files,handle);
  };
  const extension = () => resultBlob.type === "image/jpeg" ? "jpg" : resultBlob.type === "video/mp4" ? "mp4" : "gif";
  const saveName = () => filename.replace(/\.gif$/i,"") + "_ed." + extension();
  el("save").onclick = async () => {
    if (busy || !resultBlob) return;
    if (!window.showSaveFilePicker) return fallbackSave();
    const blob = resultBlob;
    let writable;
    try {
      const options = {suggestedName:saveName(), types:[{description:extension().toUpperCase(),accept:{[resultBlob.type]:["."+extension()]}}]};
      if (sourceHandle) options.startIn = sourceHandle;
      const handle = await showSaveFilePicker(options);
      writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      el("status").textContent = handle.name + " 저장을 완료했습니다.";
    } catch (error) {
      if (writable) await writable.abort().catch(() => {});
      if (error.name === "SecurityError") fallbackSave();
      else if (error.name !== "AbortError") warning("저장하지 못했습니다. 다른 위치를 선택해 다시 시도해 주세요.");
    }
  };
  function fallbackSave() {
    el("saveName").value = saveName();
    el("saveDialog").returnValue = "";
    el("saveDialog").showModal();
  }
  el("saveDialog").onclose = () => {
    if (el("saveDialog").returnValue !== "save") return;
    const a = document.createElement("a");
    a.href = resultUrl;
    const name = el("saveName").value.trim() || saveName();
    a.download = name.toLowerCase().endsWith("."+extension()) ? name : name+"."+extension();
    a.click();
  };
  async function applyTool(progress) {
    if (activeTool === "Resize") {
      const width = size("x"), height = size("y");
      return {blob:await resizeGif(source,width,height,progress),width,height};
    }
    if (activeTool === "Format Convert") {
      const format = el("format").value;
      const frame = el("jpgFrame").valueAsNumber;
      if (format === "jpg" && !(Number.isInteger(frame) && frame >= 1 && frame <= source.frames.length)) {
        throw Error("1부터 " + source.frames.length + " 사이의 프레임 번호를 입력해 주세요.");
      }
      if (format === "mp4") {
        encoderReady ??= new Promise((resolve,reject) => {
          const script = document.createElement("script");
          script.src = "vendor/h264-mp4-encoder.js";
          script.onload = resolve;
          script.onerror = () => { encoderReady = null; reject(Error("MP4 인코더를 불러오지 못했습니다. 다시 시도해 주세요.")); };
          document.head.append(script);
        });
        await encoderReady;
      }
      return exportGif(source,format,frame,progress);
    }
    const opts = {rotate:el("rotate").value,ratio:Number(el("ratio").value),fill:el("fill").value,color:el("color").value,
      rate:Number(el("rate").value),shrink:el("shrink").checked,drop:el("dropFrames").checked,low:el("low").checked,
      start:Math.round(el("start").valueAsNumber*100),end:Math.round(el("end").valueAsNumber*100)};
    if (activeTool === "Cut" && !(opts.start >= 0 && opts.start < opts.end && opts.end <= Math.round(Number(el("end").max)*100))) {
      throw Error("전체 길이 안에서 시작 시간보다 늦은 종료 시간을 선택해 주세요.");
    }
    return {blob:await GifTools.edit(source,activeTool,opts,progress)};
  }
  el("go").onclick = async () => {
    if (busy) return;
    busy = true;
    drawHistory();
    warning();
    const controls = [...el("settings").querySelectorAll("input, select, button"), el("reset"), el("save")];
    controls.forEach(control => control.disabled = true);
    el("original").open = false;
    try {
      el("status").textContent = activeTool + " 처리 중…";
      const output = await applyTool((i, count) => {
        el("status").textContent = activeTool + " 처리 중 · " + i + " / " + count + " 프레임";
      });
      const blob = output.blob;
      const gif = blob.type === "image/gif" ? inspectGif(new Uint8Array(await blob.arrayBuffer())) : null;
      const delta = source.bytes.length - blob.size;
      const tool = activeTool;
      const width = gif?.width ?? output.width, height = gif?.height ?? output.height;
      const detail = tool === "Resize" || tool === "Crop" ? width + "×" + height :
        tool === "Speed" ? el("rate").value + "배" :
        tool === "Rotate" ? el("rotate").selectedOptions[0].textContent :
        tool === "Cut" ? el("start").value + "–" + el("end").value + "초" :
        tool === "Format Convert" ? el("format").value.toUpperCase() : "";
      const step = {tool,label:[tool,detail].filter(Boolean).join(" · "),width,height,blob,
        frames:gif?.frames.length,gifStep:gif ? position+1 : steps[position].gifStep};
      steps.splice(position+1,steps.length,step);
      position++;
      current = gif || source;
      drawResult();
      await persist(step);
      showTool(tool);
      if (activeTool === "Optimize" || activeTool === "Downsizing") {
        el("status").textContent = delta === 0 ? "현재 설정에서 파일 크기가 같습니다." :
          Math.abs(delta).toLocaleString() + "바이트 " + (delta > 0 ? "줄었습니다." : "늘었습니다.");
      } else {
        el("status").textContent = activeTool + " 작업을 완료했습니다.";
      }
    } catch (error) {
      el("original").open = true;
      warning(error.message || "편집하지 못했습니다. 설정을 확인해 주세요.");
      el("status").textContent = "";
    } finally {
      busy = false;
      controls.forEach(control => control.disabled = false);
      drawHistory();
    }
  };
  async function restoreDraft() {
    el("upload").inert = true;
    try {
      const [meta,...saved] = await editorDraft.read();
      if (meta && saved[meta.position]) {
        const file = new File([saved[0].blob],meta.filename,{type:"image/gif"});
        await load([file],meta.sourceHandle,{position:meta.position,steps:saved});
      }
    } catch {
      el("draftNote").textContent = "작업 기록은 현재 화면에서 유지됩니다.";
    } finally {
      el("upload").inert = false;
    }
  }
  restoreDraft();
})();
