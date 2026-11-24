(() => {
  "use strict";
  const el = id => document.getElementById(id);
  const toolIcons = [
    ["Resize", "⤢"], ["Crop", "✂"], ["Downsizing", "↘"],
    ["Format Convert", "⇄"], ["Rotate", "⟳"], ["Optimize", "⚙"],
    ["Reverse", "◀◀"], ["Speed", "◷"], ["Cut", "✄"]
  ];
  let source, filename, originalUrl, resultUrl;
  let locked = true, busy = false, lastAxis = "x";

  function warning(message = "") {
    el("warning").textContent = message;
    el("warning").hidden = !message;
  }
  function showTool(name) {
    const resize = name === "Resize";
    el("toolTitle").textContent = name || "편집 도구";
    el("tools").hidden = Boolean(name);
    el("settings").hidden = !name;
    el("resizeControls").hidden = !resize;
    el("go").hidden = !resize;
    el("pending").hidden = resize;
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
  }
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
  function info(width, height, blob) {
    const bytes = blob.size;
    const amount = bytes < 1024 ? bytes + " B" : bytes < 1048576
      ? (bytes / 1024).toFixed(1) + " KB" : (bytes / 1048576).toFixed(2) + " MB";
    return width + " × " + height + " px · " + amount + " · " + source.frames.length + "프레임";
  }
  async function load(files) {
    if (busy || !files.length) return;
    if (files.length !== 1) return warning("GIF 파일을 한 번에 1개만 선택해 주세요.");
    busy = true;
    warning();
    el("status").textContent = "파일을 확인하고 있습니다.";
    try {
      const file = files[0];
      const gif = inspectGif(new Uint8Array(await file.arrayBuffer()));
      const url = URL.createObjectURL(new Blob([file], { type: "image/gif" }));
      if (originalUrl) URL.revokeObjectURL(originalUrl);
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      source = gif;
      filename = file.name;
      originalUrl = url;
      resultUrl = null;
      el("originalImage").src = url;
      el("originalName").textContent = filename;
      el("originalInfo").textContent = info(gif.width, gif.height, file);
      el("original").open = true;
      el("result").hidden = true;
      el("upload").hidden = true;
      el("workspace").hidden = false;
      el("x").value = el("y").value = 100;
      locked = true;
      updateSizes();
      showTool("");
    } catch (error) {
      warning(error.message || "파일을 열 수 없습니다.");
    } finally {
      busy = false;
      el("status").textContent = "";
    }
  }
  el("choose").onclick = el("reset").onclick = () => { if (!busy) el("file").click(); };
  el("file").onchange = event => {
    const files = Array.from(event.target.files);
    event.target.value = "";
    load(files);
  };
  for (const name of ["dragover", "drop"]) document.addEventListener(name, event => event.preventDefault());
  el("drop").ondragover = () => el("drop").classList.add("over");
  el("drop").ondragleave = () => el("drop").classList.remove("over");
  el("drop").ondrop = event => {
    event.preventDefault();
    el("drop").classList.remove("over");
    load(Array.from(event.dataTransfer.files));
  };
  el("go").onclick = async () => {
    if (busy) return;
    busy = true;
    warning();
    const controls = [...el("settings").querySelectorAll("input, button"), el("reset")];
    controls.forEach(control => control.disabled = true);
    const width = size("x"), height = size("y");
    el("original").open = false;
    try {
      const blob = await resizeGif(source, width, height, (i, count) => {
        el("status").textContent = "크기 조절 중 · " + i + " / " + count + " 프레임";
      });
      const url = URL.createObjectURL(blob);
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      resultUrl = url;
      const name = "Resized_" + filename.replace(/\.gif$/i, "") + ".gif";
      el("resultImage").src = el("download").href = url;
      el("download").download = el("resultName").textContent = name;
      el("resultInfo").textContent = info(width, height, blob);
      el("result").hidden = false;
      el("status").textContent = "크기 조절을 완료했습니다.";
    } catch (error) {
      el("original").open = true;
      warning(error.message || "크기를 조절하지 못했습니다.");
      el("status").textContent = "";
    } finally {
      busy = false;
      controls.forEach(control => control.disabled = false);
    }
  };
})();
