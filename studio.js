(() => {
  const creator = document.getElementById("creatorView");
  const editor = document.getElementById("editorView");
  function select() {
    const editing = location.hash === "#editor";
    const mode = editing ? "editor" : "creator";
    document.documentElement.dataset.mode = mode;
    creator.inert = editing;
    editor.inert = !editing;
    document.title = editing ? "쓰기 쉬운 GIF 편집기" : "스마트 GIF 생성기";
    for (const tab of document.querySelectorAll(".mode-nav a")) {
      if (tab.dataset.mode === mode) tab.setAttribute("aria-current","page");
      else tab.removeAttribute("aria-current");
    }
  }
  addEventListener("hashchange",select);
  select();
})();
